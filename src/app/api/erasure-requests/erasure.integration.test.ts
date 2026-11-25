import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

/*
 * Erasure on request (#279): who may log and carry out a request, what
 * erasing deletes and what it keeps, and that nothing recorded before it
 * brings an erased household back.
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: listRequests, POST: createRequest } = await import("./route");
const { POST: eraseRoute } = await import("./[id]/erase/route");
const { POST: markWithdrawn, DELETE: clearWithdrawn } =
  await import("../households/[id]/contact-withdrawal/route");
const { POST: recordVisit } = await import("../visits/route");
const { PATCH: amendVisit } = await import("../visits/[id]/route");
const { POST: sync } = await import("../visits/sync/route");
const { GET: listHouseholds } = await import("../households/route");
const { GET: householdHistory } = await import("../households/[id]/route");
const { POST: addFollowUp } = await import("../follow-ups/route");
const { GET: getUser } = await import("../users/[id]/route");
const { GET: listUsers } = await import("../users/route");
const { GET: getMe } = await import("../users/me/route");
const { createAccessRequest } = await import("@/server/users/service");
const { getDatabase } = await import("@/db/client");
const { eraseRequest } = await import("@/server/privacy/requests");

const pool = createTestPool();
const ADMIN = "27927900-0000-4000-8000-000000000001";
const ADMIN2 = "27927900-0000-4000-8000-000000000002";
const ALICE = "27927900-0000-4000-8000-000000000003";
const BEN = "27927900-0000-4000-8000-000000000004";
const BLOCK = "27927900-0000-4000-8001-000000000001";
const SESSION = "27927900-0000-4000-8002-000000000001";
const HOUSEHOLD = "27927900-0000-4000-8003-000000000001";
const OTHER_HOUSEHOLD = "27927900-0000-4000-8003-000000000002";
const VISIT = "01960000-0000-7000-8279-000000000001";
const OTHER_VISIT = "01960000-0000-7000-8279-000000000002";
const NOTE = "27927900-0000-4000-8004-000000000001";
const REMOVED_NOTE = "27927900-0000-4000-8004-000000000002";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

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

type ErrorBody = { error: { code: string; message: string; details?: { path: string }[] } };
type RequestBody = {
  id: string;
  kind: string;
  household: { id: string; name: string | null; contactWithdrawnAt: string | null } | null;
  loggedBy: { id: string; name: string | null };
  erasedAt: string | null;
  erasedBy: { id: string } | null;
};
type ListBody = {
  data: RequestBody[];
  pagination: { total: number };
  lastRetentionRun: unknown;
};

const failure = async (response: Response) => ((await response.json()) as ErrorBody).error;
const ask = (body: unknown) => call(createRequest, "POST", "/erasure-requests", {}, body);
const erase = (id: string) => call(eraseRoute, "POST", `/erasure-requests/${id}/erase`, { id });
const open = async (): Promise<ListBody> =>
  (await (await call(listRequests, "GET", "/erasure-requests")).json()) as ListBody;
const count = async (table: string, where = "true"): Promise<number> =>
  Number(
    (await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0]
      ?.n,
  );
const row = async <T>(sql: string, args: unknown[] = []): Promise<T> =>
  (await pool.query(sql, args)).rows[0] as T;

const knock = (overrides: Record<string, unknown> = {}) => ({
  id: "01960000-0000-7000-8279-0000000000a1",
  blockId: BLOCK,
  unitNumber: "#05-123",
  interestLevel: "high",
  ...overrides,
});

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'admin2@t.local','Admin Two','admin'),
      ($3,'alice@t.local','Alice','member'), ($4,'ben@t.local','Ben','member')`,
    [ADMIN, ADMIN2, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at)
     VALUES ($1,'Live','active',$2,'2026-01-01T00:00:00Z')`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, name, contact, religion) VALUES
      ($1,$2,'#05-123','Mr Tan','91234567','buddhist'), ($3,$2,'#05-124','Mrs Lim',NULL,NULL)`,
    [HOUSEHOLD, BLOCK, OTHER_HOUSEHOLD],
  );
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, description,
                         client_created_at, created_at, updated_at) VALUES
      ($1,$2,$3,$4,'high','Wants a call back','2026-02-01T10:00:00Z','2026-02-01T10:00:00Z','2026-02-01T10:00:00Z'),
      ($5,$6,$3,$4,'low','Not home','2026-02-01T11:00:00Z','2026-02-01T11:00:00Z','2026-02-01T11:00:00Z')`,
    [VISIT, HOUSEHOLD, SESSION, ALICE, OTHER_VISIT, OTHER_HOUSEHOLD],
  );
  await pool.query(
    `INSERT INTO follow_ups (id, household_id, author_id, status, note, listed_at, listed_by,
                             deleted_at, deleted_by, delete_reason) VALUES
      ($1,$2,$3,'listed','Bring the flyer',now(),$3,NULL,NULL,NULL),
      ($4,$2,$3,'listed','Asked about the choir',now(),$3,now(),$3,'Moved away')`,
    [NOTE, HOUSEHOLD, ADMIN, REMOVED_NOTE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("logging a request", () => {
  it("lets a member pass on a household's, once, and answers again with the open one", async () => {
    asAlice();
    const first = await ask({ kind: "household", id: HOUSEHOLD });
    expect(first.status).toBe(201);
    const logged = (await first.json()) as RequestBody;
    expect(logged).toMatchObject({
      kind: "household",
      erasedAt: null,
      erasedBy: null,
      loggedBy: { id: ALICE },
    });

    const again = await ask({ kind: "household", id: HOUSEHOLD });
    expect(again.status).toBe(200);
    expect(((await again.json()) as RequestBody).id).toBe(logged.id);
    expect(await count("erasure_requests")).toBe(1);
  });

  it("refuses a member naming an account, whoever it is", async () => {
    asAlice();
    const response = await ask({ kind: "account", id: BEN });
    expect(response.status).toBe(403);
    expect(await count("erasure_requests")).toBe(0);
  });

  it("lets an admin log an account's request, once", async () => {
    asAdmin();
    const response = await ask({ kind: "account", id: BEN });
    expect(response.status).toBe(201);
    const logged = (await response.json()) as RequestBody;
    expect(logged).toMatchObject({ kind: "account", account: { id: BEN } });

    const again = await ask({ kind: "account", id: BEN });
    expect(again.status).toBe(200);
    expect(((await again.json()) as RequestBody).id).toBe(logged.id);
  });

  it("keeps the day the person asked, and refuses one in the future", async () => {
    asAlice();
    const earlier = await ask({
      kind: "household",
      id: HOUSEHOLD,
      requestedAt: "2026-03-01T04:00:00.000Z",
    });
    expect(earlier.status).toBe(201);
    expect(
      (await row<{ requested_at: Date }>(`SELECT requested_at FROM erasure_requests`)).requested_at,
    ).toEqual(new Date("2026-03-01T04:00:00.000Z"));

    const later = await ask({
      kind: "household",
      id: OTHER_HOUSEHOLD,
      requestedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(later.status).toBe(400);
    expect((await failure(later)).details?.[0]?.path).toBe("/requestedAt");
  });

  it("answers 404 for a household or an account that is not there", async () => {
    asAdmin();
    const missing = "27927900-0000-4000-8003-0000000000ff";
    expect((await ask({ kind: "household", id: missing })).status).toBe(404);
    expect((await ask({ kind: "account", id: missing })).status).toBe(404);
  });

  it("is refused for a unit erased and not recorded at since", async () => {
    asAdmin();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    expect((await erase(logged.id)).status).toBe(200);

    const response = await ask({ kind: "household", id: HOUSEHOLD });
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("household_erased");
  });
});

describe("who may read and carry out a request", () => {
  it("refuses a member the list, and the erasure", async () => {
    asAlice();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;

    expect((await call(listRequests, "GET", "/erasure-requests")).status).toBe(403);
    expect((await erase(logged.id)).status).toBe(403);
    expect(
      (await row<{ name: string }>(`SELECT name FROM households WHERE id = $1`, [HOUSEHOLD])).name,
    ).toBe("Mr Tan");
  });

  it("lists the waiting ones oldest first and the erased ones newest first", async () => {
    asAdmin();
    await ask({ kind: "household", id: OTHER_HOUSEHOLD, requestedAt: "2026-03-05T00:00:00.000Z" });
    const first = (await (
      await ask({ kind: "household", id: HOUSEHOLD, requestedAt: "2026-03-01T00:00:00.000Z" })
    ).json()) as RequestBody;

    const waiting = await open();
    expect(waiting.data.map((request) => request.household?.id)).toEqual([
      HOUSEHOLD,
      OTHER_HOUSEHOLD,
    ]);
    expect(waiting.pagination.total).toBe(2);
    expect(waiting.lastRetentionRun).toBeNull();

    await erase(first.id);
    const erased = (await (
      await call(listRequests, "GET", "/erasure-requests?status=erased")
    ).json()) as ListBody;
    expect(erased.data.map((request) => request.id)).toEqual([first.id]);
    expect((await open()).data).toHaveLength(1);
  });

  it("shows the retention job's last run beside the list, and an empty list as empty", async () => {
    asAdmin();
    expect((await open()).data).toEqual([]);

    await pool.query(
      `INSERT INTO retention_runs (started_at, finished_at, households, accounts, sign_ins, more)
       VALUES ('2026-11-24T18:00:00Z','2026-11-24T18:00:03Z',2,1,5,true),
              ('2026-11-25T18:00:00Z','2026-11-25T18:00:02Z',0,0,3,false),
              ('2026-11-26T18:00:00Z',NULL,9,9,9,false)`,
    );
    expect((await open()).lastRetentionRun).toEqual({
      ranAt: "2026-11-25T18:00:00.000Z",
      households: 0,
      accounts: 0,
      signIns: 3,
      more: false,
    });
  });

  it("answers 404 for a request that is not there", async () => {
    asAdmin();
    expect((await erase("27927900-0000-4000-8005-0000000000ff")).status).toBe(404);
  });
});

describe("erasing a household", () => {
  it("deletes its identity, visits and every note, and keeps the unit and who erased it", async () => {
    asAlice();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    await pool.query(`UPDATE households SET contact_withdrawn_at = now() WHERE id = $1`, [
      HOUSEHOLD,
    ]);
    asAdmin();

    const response = await erase(logged.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      erasedBy: { id: ADMIN },
      household: { name: null, contactWithdrawnAt: null },
    });

    expect(
      await row(
        `SELECT name, contact, religion, contact_withdrawn_at, erased_at IS NOT NULL AS erased
           FROM households WHERE id = $1`,
        [HOUSEHOLD],
      ),
    ).toEqual({
      name: null,
      contact: null,
      religion: null,
      contact_withdrawn_at: null,
      erased: true,
    });
    expect(await count("visits", `household_id = '${HOUSEHOLD}'`)).toBe(0);
    expect(await count("follow_ups", `household_id = '${HOUSEHOLD}'`)).toBe(0);
    // Another unit is untouched.
    expect(await count("visits", `household_id = '${OTHER_HOUSEHOLD}'`)).toBe(1);
    expect(
      (await row<{ name: string }>(`SELECT name FROM households WHERE id = $1`, [OTHER_HOUSEHOLD]))
        .name,
    ).toBe("Mrs Lim");
    expect(
      await row(`SELECT logged_by, erased_by FROM erasure_requests WHERE id = $1`, [logged.id]),
    ).toEqual({ logged_by: ALICE, erased_by: ADMIN });
  });

  it("will not carry out a request twice", async () => {
    asAdmin();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    await erase(logged.id);
    const again = await erase(logged.id);
    expect(again.status).toBe(409);
    expect((await failure(again)).code).toBe("conflict");
  });

  it("keeps a session's pick of the household", async () => {
    await pool.query(
      `INSERT INTO outing_sessions (id, title, kind, status, created_by)
       VALUES ('27927900-0000-4000-8002-000000000002','Return','follow_up','draft',$1)`,
      [ADMIN],
    );
    await pool.query(
      `INSERT INTO session_households (session_id, household_id)
       VALUES ('27927900-0000-4000-8002-000000000002',$1)`,
      [HOUSEHOLD],
    );
    asAdmin();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    await erase(logged.id);
    expect(await count("session_households")).toBe(1);
  });

  it("deletes the teammate snapshots with the visits", async () => {
    await pool.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [
      VISIT,
      BEN,
    ]);
    asAdmin();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    await erase(logged.id);
    expect(await count("visit_teammates")).toBe(0);
  });
});

describe("after an erasure", () => {
  async function eraseUnit(): Promise<Date> {
    asAdmin();
    const logged = (await (await ask({ kind: "household", id: HOUSEHOLD })).json()) as RequestBody;
    await erase(logged.id);
    return (
      await row<{ erased_at: Date }>(`SELECT erased_at FROM households WHERE id = $1`, [HOUSEHOLD])
    ).erased_at;
  }

  it("refuses a visit recorded before it, from POST /visits", async () => {
    const erasedAt = await eraseUnit();
    asAlice();
    const response = await recordVisit(
      new Request("https://test.local/api/visits", {
        method: "POST",
        body: JSON.stringify(
          knock({
            clientCreatedAt: new Date(erasedAt.getTime() - 60_000).toISOString(),
            name: "Mr Tan",
          }),
        ),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("household_erased");
    expect(await count("visits", `household_id = '${HOUSEHOLD}'`)).toBe(0);
    expect(
      (await row<{ name: string | null }>(`SELECT name FROM households WHERE id = $1`, [HOUSEHOLD]))
        .name,
    ).toBeNull();
  });

  it("takes a visit recorded after it as a new knock, and learns the identity again", async () => {
    await eraseUnit();
    asAlice();
    const response = await call(recordVisit, "POST", "/visits", {}, knock({ name: "Mr Tan Jr" }));
    expect(response.status).toBe(201);
    expect(
      (await row<{ name: string }>(`SELECT name FROM households WHERE id = $1`, [HOUSEHOLD])).name,
    ).toBe("Mr Tan Jr");
  });

  it("refuses a queued record from before it, and applies one from after", async () => {
    const erasedAt = await eraseUnit();
    asAlice();
    const before = new Date(erasedAt.getTime() - 3_600_000).toISOString();
    const after = new Date().toISOString();
    const response = await call(
      sync,
      "POST",
      "/visits/sync",
      {},
      {
        sentAt: new Date().toISOString(),
        items: [
          {
            ...knock({ id: "01960000-0000-7000-8279-0000000000b1", clientCreatedAt: before }),
            updatedAt: before,
          },
          {
            ...knock({ id: "01960000-0000-7000-8279-0000000000b2", clientCreatedAt: after }),
            updatedAt: after,
          },
        ],
      },
    );
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as {
      results: { status: string; error?: { error: { code: string } } }[];
    };
    expect(results.map((result) => result.status)).toEqual(["rejected", "applied"]);
    expect(results[0]?.error?.error.code).toBe("household_erased");
    expect(await count("visits", `household_id = '${HOUSEHOLD}'`)).toBe(1);
  });

  it("refuses an amend of a visit the erasure deleted, and answers 404 to a PATCH", async () => {
    await eraseUnit();
    asAlice();
    const amended = await call(
      sync,
      "POST",
      "/visits/sync",
      {},
      {
        sentAt: new Date().toISOString(),
        items: [
          {
            ...knock({ id: VISIT, clientCreatedAt: "2026-02-01T10:00:00.000Z" }),
            interestLevel: "low",
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    );
    const { results } = (await amended.json()) as {
      results: { status: string; error?: { error: { code: string } } }[];
    };
    expect(results[0]?.error?.error.code).toBe("household_erased");

    const patched = await call(
      amendVisit,
      "PATCH",
      `/visits/${VISIT}`,
      { id: VISIT },
      { description: "x" },
    );
    expect(patched.status).toBe(404);
  });

  it("stops listing the bare unit, and lists it again once it is visited", async () => {
    await eraseUnit();
    asAlice();
    const names = async () =>
      (
        (await (
          await listHouseholds(new Request(`https://test.local/api/households?blockId=${BLOCK}`))
        ).json()) as { data: { household: { id: string } }[] }
      ).data.map((entry) => entry.household.id);

    expect(await names()).toEqual([OTHER_HOUSEHOLD]);
    await call(recordVisit, "POST", "/visits", {}, knock());
    expect(await names()).toEqual([HOUSEHOLD, OTHER_HOUSEHOLD]);
  });

  it("reads the unit's history as the unit alone", async () => {
    await eraseUnit();
    asAlice();
    const response = await householdHistory(
      new Request(`https://test.local/api/households/${HOUSEHOLD}`),
      { params: Promise.resolve({ id: HOUSEHOLD }) },
    );
    expect(await response.json()).toMatchObject({
      household: { name: null, contact: null },
      visits: [],
      followUps: [],
      pagination: { total: 0 },
    });
  });

  it("refuses a follow-up on a unit with nothing recorded since, and allows one after a visit", async () => {
    await eraseUnit();
    asAdmin();
    const note = { householdId: HOUSEHOLD, note: "Call back" };
    const refused = await call(addFollowUp, "POST", "/follow-ups", {}, note);
    expect(refused.status).toBe(409);
    expect((await failure(refused)).code).toBe("household_erased");

    asAlice();
    await call(recordVisit, "POST", "/visits", {}, knock());
    asAdmin();
    expect((await call(addFollowUp, "POST", "/follow-ups", {}, note)).status).toBe(201);
  });
});

describe("a withdrawn agreement to calls or messages", () => {
  it("is marked by a member, keeps its first time, and is cleared by an admin alone", async () => {
    asAlice();
    const marked = await call(
      markWithdrawn,
      "POST",
      `/households/${HOUSEHOLD}/contact-withdrawal`,
      {
        id: HOUSEHOLD,
      },
    );
    expect(marked.status).toBe(200);
    const first = ((await marked.json()) as { contactWithdrawnAt: string }).contactWithdrawnAt;
    expect(first).toEqual(expect.any(String));

    const again = await call(markWithdrawn, "POST", `/households/${HOUSEHOLD}/contact-withdrawal`, {
      id: HOUSEHOLD,
    });
    expect(((await again.json()) as { contactWithdrawnAt: string }).contactWithdrawnAt).toBe(first);

    const refused = await call(
      clearWithdrawn,
      "DELETE",
      `/households/${HOUSEHOLD}/contact-withdrawal`,
      { id: HOUSEHOLD },
    );
    expect(refused.status).toBe(403);

    asAdmin();
    const cleared = await call(
      clearWithdrawn,
      "DELETE",
      `/households/${HOUSEHOLD}/contact-withdrawal`,
      { id: HOUSEHOLD },
    );
    expect(await cleared.json()).toMatchObject({ contactWithdrawnAt: null });
    // Clearing what is not marked changes nothing.
    const twice = await call(
      clearWithdrawn,
      "DELETE",
      `/households/${HOUSEHOLD}/contact-withdrawal`,
      { id: HOUSEHOLD },
    );
    expect(twice.status).toBe(200);
  });

  it("needs a contact to withdraw from, and a household that is there", async () => {
    asAlice();
    const noContact = await call(
      markWithdrawn,
      "POST",
      `/households/${OTHER_HOUSEHOLD}/contact-withdrawal`,
      { id: OTHER_HOUSEHOLD },
    );
    expect(noContact.status).toBe(409);

    const missing = "27927900-0000-4000-8003-0000000000ff";
    const none = await call(markWithdrawn, "POST", `/households/${missing}/contact-withdrawal`, {
      id: missing,
    });
    expect(none.status).toBe(404);
  });
});

describe("erasing an account", () => {
  async function requestFor(id: string): Promise<string> {
    asAdmin();
    return ((await (await ask({ kind: "account", id })).json()) as RequestBody).id;
  }

  it("anonymises it in place, ends its sign-ins and links, and keeps what it recorded", async () => {
    await pool.query(
      `INSERT INTO accounts (user_id, type, provider, provider_account_id)
       VALUES ($1,'oidc','google','g-1')`,
      [ALICE],
    );
    await pool.query(
      `UPDATE users SET password_hash = 'x', image = 'https://i/x.png', email_verified = now() WHERE id = $1`,
      [ALICE],
    );
    await pool.query(`INSERT INTO verification_tokens VALUES ('alice@t.local','tok', now())`);
    const stale = await signedInAs(pool, { id: ALICE, role: "member" });
    auth.mockImplementation(() => Promise.resolve(stale));
    expect((await call(getMe, "GET", "/users/me")).status).toBe(200);

    const id = await requestFor(ALICE);
    const response = await erase(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { id: ALICE, name: null } });

    const user = await row<Record<string, unknown>>(
      `SELECT name, email, image, password_hash, email_verified, erased_at IS NOT NULL AS erased,
              deactivated_at IS NOT NULL AS deactivated FROM users WHERE id = $1`,
      [ALICE],
    );
    expect(user).toEqual({
      name: null,
      email: `erased-${ALICE}@erased.invalid`,
      image: null,
      password_hash: null,
      email_verified: null,
      erased: true,
      deactivated: true,
    });
    expect(await count("accounts")).toBe(0);
    expect(await count("sign_ins", `user_id = '${ALICE}'`)).toBe(0);
    expect(await count("verification_tokens")).toBe(0);
    expect(await count("visits", `member_id = '${ALICE}'`)).toBe(2);

    // The token it held is of no use: the account is deactivated with its sign-ins gone.
    auth.mockImplementation(() => Promise.resolve(stale));
    const old = await call(getMe, "GET", "/users/me");
    expect(old.status).toBe(403);
    expect((await failure(old)).code).toBe("account_deactivated");
  });

  it("never lists it again, and answers 404 for it", async () => {
    const id = await requestFor(ALICE);
    await erase(id);
    asAdmin();
    const listed = (await (
      await call(listUsers, "GET", "/users?includeDeactivated=true")
    ).json()) as { data: { id: string }[] };
    expect(listed.data.map((entry) => entry.id)).not.toContain(ALICE);
    expect((await call(getUser, "GET", `/users/${ALICE}`, { id: ALICE })).status).toBe(404);
  });

  it("frees the email, so Google sign-in makes a new account waiting for approval", async () => {
    const id = await requestFor(ALICE);
    await erase(id);
    const made = await createAccessRequest(getDatabase(), {
      email: "alice@t.local",
      name: "Alice",
    });
    expect(made).toMatchObject({ email: "alice@t.local" });
    expect(made?.id).not.toBe(ALICE);
  });

  it("will not erase the caller's own account", async () => {
    const id = await requestFor(ADMIN);
    const response = await erase(id);
    expect(response.status).toBe(409);
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(0);
  });

  it("will not erase the last active admin", async () => {
    const id = await requestFor(ADMIN2);
    // The caller was deactivated meanwhile, so nobody else is an active admin.
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ADMIN]);
    await expect(
      eraseRequest(getDatabase(), id, { id: ADMIN, role: "admin" }, new Date()),
    ).rejects.toMatchObject({ status: 409 });
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(0);
  });

  it("erases a rejected or waiting account without deactivating it", async () => {
    await pool.query(
      `INSERT INTO users (id, email, name, role, approval)
       VALUES ('27927900-0000-4000-8000-0000000000a1','pat@gmail.com','Pat','member','pending')`,
    );
    const id = await requestFor("27927900-0000-4000-8000-0000000000a1");
    expect((await erase(id)).status).toBe(200);
    expect(
      await row(
        `SELECT deactivated_at, name FROM users WHERE id = '27927900-0000-4000-8000-0000000000a1'`,
      ),
    ).toEqual({ deactivated_at: null, name: null });
  });

  it("answers 404 to an account request whose account was erased meanwhile", async () => {
    const id = await requestFor(BEN);
    await pool.query(`UPDATE users SET erased_at = now() WHERE id = $1`, [BEN]);
    expect((await erase(id)).status).toBe(404);
  });
});
