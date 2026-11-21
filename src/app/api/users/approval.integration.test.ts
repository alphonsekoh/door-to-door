import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, testSignInId, truncateAll } from "@/db/testing";

/*
 * Google sign-up with an admin's approval (#249): what an account waiting
 * for approval, or rejected, may do; how an admin moves it; and that nobody
 * outside the team turns up in it.
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: listUsers, POST: createUser } = await import("./route");
const { PATCH: updateUser } = await import("./[id]/route");
const { GET: getMe, PATCH: patchMe } = await import("./me/route");
const { POST: approve } = await import("./[id]/approve/route");
const { POST: reject } = await import("./[id]/reject/route");
const { POST: unblock } = await import("./[id]/unblock/route");
const { GET: activeSession } = await import("../sessions/active/route");
const { POST: createVisit } = await import("../visits/route");
const { GET: listFollowUps } = await import("../follow-ups/route");
const { POST: createTeam } = await import("../sessions/[id]/teams/route");
const { POST: addTeamMember } = await import("../teams/[id]/members/route");

const pool = createTestPool();
const ADMIN = "24924900-0000-4000-8000-000000000001";
const ALICE = "24924900-0000-4000-8000-000000000002";
const PAT = "24924900-0000-4000-8000-000000000003";
const QUINN = "24924900-0000-4000-8000-000000000004";
const ROB = "24924900-0000-4000-8000-000000000005";
const NOBODY = "24924900-0000-4000-8000-0000000000ff";
const BLOCK = "24924900-0000-4000-8001-000000000001";
const SESSION = "24924900-0000-4000-8002-000000000001";

const as = (id: string, role: "admin" | "member" = "member") =>
  auth.mockImplementation(() => signedInAs(pool, { id, role }));
const asAdmin = () => as(ADMIN, "admin");

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  method: string,
  url: string,
  params: Record<string, string> = {},
  body?: unknown,
): Promise<Response> {
  return (handler as Handler)(
    new Request(`https://test.local/api${url}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    { params: Promise.resolve(params as never) },
  );
}

type ErrorBody = { error: { code: string; message: string } };
type UserBody = { id: string; email: string; name: string | null; role: string; approval: string };
type ListBody = { data: UserBody[]; pagination: { total: number } };

const failure = async (response: Response) => ((await response.json()) as ErrorBody).error;
const move = (handler: unknown, id: string) => call(handler, "POST", `/users/${id}`, { id });
const list = async (query = "") =>
  (await (await call(listUsers, "GET", `/users${query}`)).json()) as ListBody;
const approvalOf = async (id: string) =>
  (await pool.query<{ approval: string }>(`SELECT approval FROM users WHERE id = $1`, [id])).rows[0]
    ?.approval;

beforeEach(async () => {
  await truncateAll(pool);
  /* Pat asked first, then Quinn; Rob was rejected. */
  await pool.query(
    `INSERT INTO users (id, email, name, role, approval, created_at) VALUES
      ($1,'admin@t.local','Admin','admin','approved','2026-01-01T00:00:00Z'),
      ($2,'alice@t.local','Alice','member','approved','2026-01-02T00:00:00Z'),
      ($3,'pat@gmail.com','Pat','member','pending','2026-03-01T00:00:00Z'),
      ($4,'quinn@gmail.com',NULL,'member','pending','2026-03-02T00:00:00Z'),
      ($5,'rob@gmail.com','Rob','member','blocked','2026-02-01T00:00:00Z')`,
    [ADMIN, ALICE, PAT, QUINN, ROB],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at)
     VALUES ($1,'Live','active',$2,now())`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("an account nobody has approved", () => {
  const visit = {
    id: "01960000-0000-7000-8249-000000000001",
    blockId: BLOCK,
    unitNumber: "#01-01",
    interestLevel: "high",
  };

  it.each<[string, string, string]>([
    ["waiting for approval", PAT, "account_pending"],
    ["rejected", ROB, "account_blocked"],
  ])("may call nothing but /users/me while %s", async (_case, id, code) => {
    as(id);
    for (const response of [
      await call(activeSession, "GET", "/sessions/active"),
      await call(createVisit, "POST", "/visits", {}, visit),
      await call(listFollowUps, "GET", "/follow-ups"),
      await call(listUsers, "GET", "/users"),
      await call(createTeam, "POST", `/sessions/${SESSION}/teams`, { id: SESSION }, { name: "Us" }),
    ]) {
      expect(response.status).toBe(403);
      expect((await failure(response)).code).toBe(code);
    }
    const { rows } = await pool.query(`SELECT 1 FROM visits UNION ALL SELECT 1 FROM session_teams`);
    expect(rows).toHaveLength(0);
  });

  it("reads its own account, approval included", async () => {
    as(PAT);
    const pending = await call(getMe, "GET", "/users/me");
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({ id: PAT, approval: "pending", role: "member" });

    as(ROB);
    expect(await (await call(getMe, "GET", "/users/me")).json()).toMatchObject({
      approval: "blocked",
    });
  });

  it("corrects the name Google gave it while waiting", async () => {
    as(QUINN);
    const response = await call(patchMe, "PATCH", "/users/me", {}, { name: "Quinn Lee" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Quinn Lee", approval: "pending" });
  });

  it("cannot rename itself once rejected", async () => {
    as(ROB);
    const response = await call(patchMe, "PATCH", "/users/me", {}, { name: "Robert" });
    expect(response.status).toBe(403);
    expect((await failure(response)).code).toBe("account_blocked");
    const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [ROB]);
    expect(rows).toEqual([{ name: "Rob" }]);
  });

  it("is let in on its next request once approved, on the same sign-in", async () => {
    as(PAT);
    expect((await call(activeSession, "GET", "/sessions/active")).status).toBe(403);

    asAdmin();
    expect((await move(approve, PAT)).status).toBe(200);

    as(PAT);
    expect((await call(activeSession, "GET", "/sessions/active")).status).toBe(200);
    const { rows } = await pool.query(`SELECT id FROM sign_ins WHERE user_id = $1`, [PAT]);
    expect(rows).toEqual([{ id: testSignInId(PAT) }]);
  });

  it("is turned away on its next request once rejected, keeping its sign-in", async () => {
    as(PAT);
    expect((await call(getMe, "GET", "/users/me")).status).toBe(200);

    asAdmin();
    expect((await move(reject, PAT)).status).toBe(200);

    /* Resolved once: a sign-in the rejection had ended would not be written back. */
    auth.mockResolvedValueOnce({
      user: { id: PAT, role: "member", deactivated: false },
      signInId: testSignInId(PAT),
    });
    const refused = await call(activeSession, "GET", "/sessions/active");
    expect((await failure(refused)).code).toBe("account_blocked");
    auth.mockResolvedValueOnce({
      user: { id: PAT, role: "member", deactivated: false },
      signInId: testSignInId(PAT),
    });
    expect(await (await call(getMe, "GET", "/users/me")).json()).toMatchObject({
      approval: "blocked",
    });
  });

  it("is never named as a visit's author or placed on a team", async () => {
    asAdmin();
    const recorded = await call(createVisit, "POST", "/visits", {}, { ...visit, memberId: PAT });
    expect(recorded.status).toBe(404);
    expect((await failure(recorded)).message).toBe("No such member.");

    const formed = await call(
      createTeam,
      "POST",
      `/sessions/${SESSION}/teams`,
      { id: SESSION },
      { name: "Pair", memberIds: [ALICE, QUINN] },
    );
    expect(formed.status).toBe(404);

    const team = (await (
      await call(
        createTeam,
        "POST",
        `/sessions/${SESSION}/teams`,
        { id: SESSION },
        { name: "Pair", memberIds: [ALICE] },
      )
    ).json()) as { id: string };
    const added = await call(
      addTeamMember,
      "POST",
      `/teams/${team.id}/members`,
      { id: team.id },
      { userId: ROB },
    );
    expect(added.status).toBe(404);

    const { rows } = await pool.query(
      `SELECT user_id FROM session_team_members UNION ALL SELECT member_id FROM visits`,
    );
    expect(rows).toEqual([{ user_id: ALICE }]);
  });
});

describe("GET /api/users", () => {
  it("lists only the team by default, in its rows and its total", async () => {
    asAdmin();
    const team = await list("?includeDeactivated=true");
    expect(team.data.map((user) => user.id)).toEqual([ADMIN, ALICE]);
    expect(team.pagination.total).toBe(2);
    expect(team.data[0]).toMatchObject({ approval: "approved" });
  });

  it("lists the queue oldest first, and those rejected, by approval", async () => {
    asAdmin();
    const queue = await list("?approval=pending&limit=1");
    expect(queue.data.map((user) => user.id)).toEqual([PAT]);
    expect(queue.pagination.total).toBe(2);
    expect((await list("?approval=pending")).data.map((user) => user.id)).toEqual([PAT, QUINN]);

    const blocked = await list("?approval=blocked");
    expect(blocked.data).toEqual([
      expect.objectContaining({ id: ROB, email: "rob@gmail.com", approval: "blocked" }),
    ]);
  });

  it("is refused to a member, whatever it asks for", async () => {
    as(ALICE);
    const response = await call(listUsers, "GET", "/users?approval=pending");
    expect(response.status).toBe(403);
    expect((await failure(response)).code).toBe("forbidden");
  });
});

describe("approving, rejecting and unblocking", () => {
  it("approves someone waiting, always as a member", async () => {
    asAdmin();
    const response = await move(approve, PAT);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: PAT,
      role: "member",
      approval: "approved",
    });
    expect((await list()).data.map((user) => user.id)).toContain(PAT);
  });

  it("rejects someone waiting, and unblocks them back into the queue", async () => {
    asAdmin();
    expect(await (await move(reject, QUINN)).json()).toMatchObject({ approval: "blocked" });
    expect(await approvalOf(QUINN)).toBe("blocked");

    expect(await (await move(unblock, QUINN)).json()).toMatchObject({ approval: "pending" });
    expect(await approvalOf(QUINN)).toBe("pending");
  });

  it.each<[string, unknown, string, string]>([
    ["approving the approved", approve, ALICE, "They've already been approved."],
    ["approving the rejected", approve, ROB, "Their request was rejected. Unblock them first."],
    [
      "rejecting the approved",
      reject,
      ALICE,
      "They've already been approved. Deactivate them instead.",
    ],
    ["rejecting the rejected", reject, ROB, "Their request was already rejected."],
    ["unblocking someone waiting", unblock, PAT, "They aren't blocked."],
    ["unblocking the approved", unblock, ALICE, "They aren't blocked."],
  ])("refuses %s with 409, changing nothing", async (_case, handler, id, message) => {
    asAdmin();
    const before = await approvalOf(id);
    const response = await move(handler, id);
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({ code: "conflict", message });
    expect(await approvalOf(id)).toBe(before);
  });

  it.each([approve, reject, unblock])("is 404 for nobody at all", async (handler) => {
    asAdmin();
    expect((await move(handler, NOBODY)).status).toBe(404);
  });

  it.each([approve, reject, unblock])(
    "is admin-only, re-checked on the server",
    async (handler) => {
      as(ALICE);
      const byMember = await move(handler, PAT);
      expect(byMember.status).toBe(403);
      expect((await failure(byMember)).code).toBe("forbidden");

      as(QUINN);
      expect((await failure(await move(handler, PAT))).code).toBe("account_pending");
      expect(await approvalOf(PAT)).toBe("pending");
    },
  );

  it("keeps a rejected account's sign-ins, so an unblock reaches its phone", async () => {
    await signedInAs(pool, { id: PAT });
    asAdmin();
    await move(reject, PAT);
    const { rows } = await pool.query(`SELECT 1 FROM sign_ins WHERE user_id = $1`, [PAT]);
    expect(rows).toHaveLength(1);
  });
});

describe("adding and changing people who are not approved", () => {
  it.each<[string, string]>([
    [
      "pat@gmail.com",
      "pat@gmail.com is waiting for approval. Approve them under Waiting for approval.",
    ],
    ["ROB@gmail.com", "rob@gmail.com wasn't approved. Unblock them under Not approved first."],
    ["alice@t.local", "That email address already belongs to someone."],
  ])("never adds %s over the top, and says what to do instead", async (email, message) => {
    asAdmin();
    const response = await call(
      createUser,
      "POST",
      "/users",
      {},
      { email, password: "password123", role: "admin" },
    );
    expect(response.status).toBe(409);
    expect((await failure(response)).message).toBe(message);
    const { rows } = await pool.query(`SELECT role FROM users WHERE lower(email) = lower($1)`, [
      email,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("adds someone approved from the start", async () => {
    asAdmin();
    const response = await call(
      createUser,
      "POST",
      "/users",
      {},
      { email: "new@t.local", password: "password123" },
    );
    expect(await response.json()).toMatchObject({ approval: "approved" });
  });

  it.each([
    [PAT, { role: "admin" }],
    [ROB, { deactivated: true }],
  ])("refuses to change %s, who has not been approved", async (id, body) => {
    asAdmin();
    const response = await call(updateUser, "PATCH", `/users/${id}`, { id }, body);
    expect(response.status).toBe(409);
    expect((await failure(response)).message).toBe(
      "They haven't been approved. Approve, reject or unblock them instead.",
    );
  });
});

describe("the database's own guard", () => {
  it.each([
    ["an admin", `UPDATE users SET role = 'admin' WHERE id = $1`],
    ["deactivated", `UPDATE users SET deactivated_at = now() WHERE id = $1`],
  ])("refuses an account waiting for approval that is %s", async (_case, statement) => {
    await expect(pool.query(statement, [PAT])).rejects.toMatchObject({
      code: "23514",
      constraint: "users_unapproved_check",
    });
  });

  it("refuses to queue a deactivated account", async () => {
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    await expect(
      pool.query(`UPDATE users SET approval = 'pending' WHERE id = $1`, [ALICE]),
    ).rejects.toMatchObject({ constraint: "users_unapproved_check" });
  });
});
