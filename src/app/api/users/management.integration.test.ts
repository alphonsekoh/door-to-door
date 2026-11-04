import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";
import { updateUser } from "@/server/users/service";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { POST } = await import("./route");
const { PATCH } = await import("./[id]/route");
const { GET: listRoute } = await import("./route");

const pool = createTestPool();
const ADMIN = "efefefef-0000-4000-8000-000000000001";
const SECOND_ADMIN = "efefefef-0000-4000-8000-000000000002";
const ALICE = "efefefef-0000-4000-8000-000000000003";
const BLOCK = "efefefef-0000-4000-8001-000000000001";
const SESSION = "efefefef-0000-4000-8002-000000000001";
const HOUSE = "efefefef-0000-4000-8003-000000000001";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

const post = (body: unknown) =>
  POST(
    new Request("https://test.local/api/users", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`https://test.local/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

type Body = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  deactivatedAt: string | null;
  lastRecordedAt: string | null;
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'),
      ($2,'second@t.local','Second Admin','admin'),
      ($3,'alice@t.local','Alice','member')`,
    [ADMIN, SECOND_ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'March','ended',$2)`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123')`, [
    HOUSE,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at) VALUES
      ('01960000-0000-7000-8030-000000000001',$1,$2,$3,'high','2026-03-14T10:00:00Z')`,
    [HOUSE, SESSION, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("POST /api/users", () => {
  it("refuses a member", async () => {
    asMember();
    expect((await post({ email: "new@t.local", password: "password123" })).status).toBe(403);
  });

  it("adds a member with an initial password", async () => {
    asAdmin();
    const response = await post({
      email: "new@t.local",
      name: "New Person",
      password: "password123",
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Body;
    expect(body).toMatchObject({ email: "new@t.local", name: "New Person", role: "member" });
    expect(body.lastRecordedAt).toBeNull();
  });

  it("stores the password hashed, never as given", async () => {
    asAdmin();
    await post({ email: "new@t.local", password: "password123" });

    const { rows } = await pool.query<{ password_hash: string }>(
      "select password_hash from users where email = 'new@t.local'",
    );
    expect(rows[0]?.password_hash).not.toContain("password123");
    expect(rows[0]?.password_hash.startsWith("$argon2")).toBe(true);
  });

  it("can add another admin", async () => {
    asAdmin();
    const response = await post({ email: "boss@t.local", password: "password123", role: "admin" });
    expect(((await response.json()) as Body).role).toBe("admin");
  });

  it("refuses an email that already belongs to someone", async () => {
    asAdmin();
    const response = await post({ email: "alice@t.local", password: "password123" });
    expect(response.status).toBe(409);
  });

  it("treats an email as the same address whatever its case", async () => {
    asAdmin();
    expect((await post({ email: "ALICE@t.local", password: "password123" })).status).toBe(409);
  });

  it("refuses a password the contract calls too short", async () => {
    asAdmin();
    expect((await post({ email: "new@t.local", password: "short" })).status).toBe(400);
  });

  it("leaves no half-made account behind when the password is refused", async () => {
    asAdmin();
    await post({ email: "new@t.local", password: "short" });
    const { rows } = await pool.query("select 1 from users where email = 'new@t.local'");
    expect(rows).toHaveLength(0);
  });
});

describe("PATCH /api/users/{id}", () => {
  it("refuses a member", async () => {
    asMember();
    expect((await patch(ALICE, { role: "admin" })).status).toBe(403);
  });

  it("promotes a member to admin", async () => {
    asAdmin();
    const body = (await (await patch(ALICE, { role: "admin" })).json()) as Body;
    expect(body.role).toBe("admin");
  });

  it("demotes another admin", async () => {
    asAdmin();
    const body = (await (await patch(SECOND_ADMIN, { role: "member" })).json()) as Body;
    expect(body.role).toBe("member");
  });

  it("refuses an admin demoting themselves", async () => {
    // One admin is the normal case, and this would lock everyone out.
    asAdmin();
    const response = await patch(ADMIN, { role: "member" });
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: { message: string } }).toMatchObject({
      error: { message: "You cannot change your own role." },
    });
  });

  it("refuses an admin deactivating themselves", async () => {
    asAdmin();
    const response = await patch(ADMIN, { deactivated: true });
    expect(response.status).toBe(409);
  });

  it("lets an admin send their own role unchanged, since nothing happens", async () => {
    asAdmin();
    expect((await patch(ADMIN, { role: "admin" })).status).toBe(200);
  });

  it("lets an admin reactivate themselves, which cannot lock anyone out", async () => {
    asAdmin();
    expect((await patch(ADMIN, { deactivated: false })).status).toBe(200);
  });

  it("deactivates a member without touching their records", async () => {
    asAdmin();
    const body = (await (await patch(ALICE, { deactivated: true })).json()) as Body;
    expect(body.deactivatedAt).not.toBeNull();

    const { rows } = await pool.query<{ member_id: string }>(
      "select member_id from visits where member_id = $1",
      [ALICE],
    );
    expect(rows).toHaveLength(1);
  });

  it("keeps a deactivated member's records attributed to them", async () => {
    // History has to survive somebody leaving the team.
    asAdmin();
    await patch(ALICE, { deactivated: true });
    const { rows } = await pool.query<{ name: string }>(
      `select u.name from visits v join users u on u.id = v.member_id`,
    );
    expect(rows[0]?.name).toBe("Alice");
  });

  it("reactivates a member", async () => {
    asAdmin();
    await patch(ALICE, { deactivated: true });
    const body = (await (await patch(ALICE, { deactivated: false })).json()) as Body;
    expect(body.deactivatedAt).toBeNull();
  });

  it("hides a deactivated member from the default listing but keeps the row", async () => {
    asAdmin();
    await patch(ALICE, { deactivated: true });

    const listed = async (q: string) =>
      (
        (await (await listRoute(new Request(`https://test.local/api/users${q}`))).json()) as {
          data: Body[];
        }
      ).data.map((user) => user.name);

    expect(await listed("")).not.toContain("Alice");
    expect(await listed("?includeDeactivated=true")).toContain("Alice");
  });

  it("reports when a member last recorded, and null for someone who never has", async () => {
    asAdmin();
    const alice = (await (await patch(ALICE, { role: "member" })).json()) as Body;
    const admin = (await (await patch(SECOND_ADMIN, { role: "admin" })).json()) as Body;
    expect(alice.lastRecordedAt).toBe("2026-03-14T10:00:00.000Z");
    expect(admin.lastRecordedAt).toBeNull();
  });

  it("rejects an empty patch rather than touching nothing", async () => {
    asAdmin();
    expect((await patch(ALICE, {})).status).toBe(400);
  });

  it("rejects a role outside the contract", async () => {
    asAdmin();
    expect((await patch(ALICE, { role: "superuser" })).status).toBe(400);
  });

  it("returns 404 for a user that does not exist", async () => {
    asAdmin();
    expect((await patch("efefefef-0000-4000-8000-0000000000ff", { role: "admin" })).status).toBe(
      404,
    );
  });
});

/*
 * Through the service: over HTTP the actor is an active admin, and may not
 * change themselves, so in sequence another active admin always remains.
 * Only two changes at once reach this rule, which races.integration.test.ts
 * holds; here the actor is anyone else.
 */
describe("the last active admin", () => {
  const lastAdmin = "The team needs at least one active admin.";
  const stored = async (id: string) =>
    (
      await pool.query<{ role: string; deactivated_at: Date | null }>(
        "select role, deactivated_at from users where id = $1",
        [id],
      )
    ).rows[0];

  beforeEach(async () => {
    await pool.query("update users set role = 'member' where id = $1", [SECOND_ADMIN]);
  });

  it("cannot be demoted, whoever asks", async () => {
    await expect(updateUser(getDatabase(), ADMIN, { role: "member" }, ALICE)).rejects.toMatchObject(
      { status: 409, code: "conflict", message: lastAdmin },
    );
    expect(await stored(ADMIN)).toEqual({ role: "admin", deactivated_at: null });
  });

  it("cannot be deactivated", async () => {
    await expect(
      updateUser(getDatabase(), ADMIN, { deactivated: true }, ALICE),
    ).rejects.toMatchObject({ status: 409, code: "conflict", message: lastAdmin });
    expect(await stored(ADMIN)).toEqual({ role: "admin", deactivated_at: null });
  });

  it("is still the last one when the other admin is deactivated", async () => {
    await pool.query("update users set role = 'admin', deactivated_at = now() where id = $1", [
      SECOND_ADMIN,
    ]);

    await expect(updateUser(getDatabase(), ADMIN, { role: "member" }, ALICE)).rejects.toMatchObject(
      { status: 409, message: lastAdmin },
    );
    expect(await stored(ADMIN)).toEqual({ role: "admin", deactivated_at: null });
  });

  it("can be sent a change that keeps them an active admin", async () => {
    const kept = await updateUser(
      getDatabase(),
      ADMIN,
      { role: "admin", deactivated: false },
      ALICE,
    );
    expect(kept).toMatchObject({ role: "admin", deactivatedAt: null });
  });

  it("is judged after the self rule, which keeps its own message", async () => {
    await expect(updateUser(getDatabase(), ADMIN, { role: "member" }, ADMIN)).rejects.toMatchObject(
      { status: 409, message: "You cannot change your own role." },
    );
  });
});
