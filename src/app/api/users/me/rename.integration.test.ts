import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabase } from "@/db/client";
import { createTestPool, truncateAll, signedInAs as withLiveSignIn } from "@/db/testing";
import { updateOwnName } from "@/server/users/service";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { PATCH } = await import("./route");
const { PATCH: patchUser } = await import("../[id]/route");
const { GET: allHistory } = await import("../../history/route");
const { GET: ownHistory } = await import("../../history/mine/route");

const pool = createTestPool();
const ALICE = "abababab-0000-4000-8000-000000000001";
const BOB = "abababab-0000-4000-8000-000000000002";
const BLOCK = "abababab-0000-4000-8001-000000000001";
const SESSION = "abababab-0000-4000-8002-000000000001";
const HOUSE = "abababab-0000-4000-8003-000000000001";
const VISIT = "01960000-0000-7000-8040-000000000001";

const signedInAs = (id: string, overrides: Record<string, unknown> = {}) =>
  auth.mockImplementation(() =>
    withLiveSignIn(pool, { id, role: "member", deactivated: false, ...overrides }),
  );

const rename = (body: unknown) =>
  PATCH(
    new Request("https://test.local/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const nameOf = async (id: string) =>
  (await pool.query<{ name: string }>("select name from users where id = $1", [id])).rows[0]?.name;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'alice@t.local','Alice','member'),
      ($2,'bob@t.local','Bob','member')`,
    [ALICE, BOB],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'March','ended',$2)`,
    [SESSION, ALICE],
  );
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123')`, [
    HOUSE,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at)
     VALUES ($1,$2,$3,$4,'high','2026-03-14T10:00:00Z')`,
    [VISIT, HOUSE, SESSION, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("PATCH /api/users/me", () => {
  it("renames the caller and stores the name trimmed", async () => {
    signedInAs(ALICE);
    const response = await rename({ name: "  Alice Tan  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ALICE, name: "Alice Tan" });
    expect(await nameOf(ALICE)).toBe("Alice Tan");
  });

  it("refuses a blank or whitespace-only name and keeps the old one", async () => {
    signedInAs(ALICE);
    for (const name of ["", "   "]) {
      const response = await rename({ name });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "validation_failed",
      );
    }
    expect(await nameOf(ALICE)).toBe("Alice");
  });

  it("counts 80 code points on the trimmed name, whatever the padding", async () => {
    signedInAs(ALICE);
    expect((await rename({ name: "a".repeat(81) })).status).toBe(400);
    expect((await rename({ name: "a".repeat(80) })).status).toBe(200);
    expect((await rename({ name: `   ${"b".repeat(80)}   ` })).status).toBe(200);
    expect(await nameOf(ALICE)).toBe("b".repeat(80));
    expect((await rename({ name: `  ${"c".repeat(81)}  ` })).status).toBe(400);
    expect(await nameOf(ALICE)).toBe("b".repeat(80));
  });

  it("counts an emoji as one character", async () => {
    signedInAs(ALICE);
    expect((await rename({ name: "😀".repeat(41) })).status).toBe(200);
    expect((await rename({ name: "😀".repeat(81) })).status).toBe(400);
  });

  it.each([
    ["zero-width only", "\u200b\u200b"],
    ["a right-to-left override", "\u202eecilA"],
    ["a control character", "Al\u0007ice"],
    ["punctuation only", "..."],
  ])("refuses a name that is %s", async (_label, name) => {
    signedInAs(ALICE);
    const response = await rename({ name });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "validation_failed",
    );
    expect(await nameOf(ALICE)).toBe("Alice");
  });

  it("refuses a body without a name, and ignores unknown fields such as a role", async () => {
    signedInAs(ALICE);
    expect((await rename({})).status).toBe(400);
    expect((await rename({ name: "Al", role: "admin" })).status).toBe(200);
    const { rows } = await pool.query<{ role: string }>("select role from users where id = $1", [
      ALICE,
    ]);
    expect(rows[0]?.role).toBe("member");
  });

  it("returns 401 without a session", async () => {
    auth.mockResolvedValue(null);
    expect((await rename({ name: "Al" })).status).toBe(401);
  });

  it("returns 403 for an account deactivated after sign-in", async () => {
    await pool.query("update users set deactivated_at = now() where id = $1", [ALICE]);
    signedInAs(ALICE);
    const response = await rename({ name: "Al" });
    expect(response.status).toBe(403);
    expect(await nameOf(ALICE)).toBe("Alice");
  });

  it("returns 401 when the account no longer exists", async () => {
    signedInAs("abababab-0000-4000-8000-0000000000ff");
    expect((await rename({ name: "Al" })).status).toBe(401);
  });

  it("refuses a rename for an account deleted once its request was let in", async () => {
    // Past the per-request check, which the route test above stops at.
    await expect(
      updateOwnName(getDatabase(), "abababab-0000-4000-8000-0000000000ff", "Al"),
    ).rejects.toMatchObject({ status: 404, message: "Your account no longer exists." });
  });

  it("only ever touches the signed-in user", async () => {
    signedInAs(ALICE);
    await rename({ name: "Alice Tan" });
    expect(await nameOf(BOB)).toBe("Bob");
  });

  it("changes no record's author, and earlier history shows the new name", async () => {
    signedInAs(ALICE);
    await rename({ name: "Alice Tan" });

    const { rows } = await pool.query<{ member_id: string }>(
      "select member_id from visits where id = $1",
      [VISIT],
    );
    expect(rows[0]?.member_id).toBe(ALICE);

    const own = await ownHistory(new Request("https://test.local/api/history/mine"));
    expect(own.status).toBe(200);
    expect(JSON.stringify(await own.json())).toContain("Alice Tan");

    await pool.query("update users set role = 'admin' where id = $1", [BOB]);
    signedInAs(BOB);
    const shared = await allHistory(new Request("https://test.local/api/history"));
    const text = JSON.stringify(await shared.json());
    expect(text).toContain("Alice Tan");
    expect(text).not.toContain('"Alice"');
  });
});

describe("PATCH /api/users/{id}", () => {
  it("is still admin-only: a member cannot rename another member", async () => {
    signedInAs(BOB);
    const response = await patchUser(
      new Request(`https://test.local/api/users/${ALICE}`, {
        method: "PATCH",
        body: JSON.stringify({ deactivated: true }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: ALICE }) },
    );
    expect(response.status).toBe(403);
    expect(await nameOf(ALICE)).toBe("Alice");
  });
});
