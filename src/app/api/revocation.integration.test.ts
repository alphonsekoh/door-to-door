import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

/*
 * The token below never changes: it still says "admin, not deactivated", as a
 * real JWT does until it expires. Only the database row moves, and the handlers
 * must follow it on the very next request (#83).
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound }));

const me = await import("./users/me/route");
const visits = await import("./visits/route");
const sync = await import("./visits/sync/route");
const mine = await import("./history/mine/route");
const allHistory = await import("./history/route");
const usersRoute = await import("./users/route");
const sessionsRoute = await import("./sessions/route");
const followUps = await import("./follow-ups/route");
const blocksRoute = await import("./blocks/route");
const { requireAdminPage } = await import("@/server/auth/pages");

const pool = createTestPool();
const USER = "f1f1f1f1-0000-4000-8000-000000000001";
const SESSION = "f1f1f1f1-0000-4000-8002-000000000001";
const BLOCK = "f1f1f1f1-0000-4000-8001-000000000001";

const json = (method: string, path: string, body?: unknown) =>
  new Request(`https://test.local/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

let seq = 0;
const visitBody = () => ({
  id: `01960000-0000-7000-8090-${String(++seq).padStart(12, "0")}`,
  blockId: BLOCK,
  unitNumber: "#01-01",
  interestLevel: "low",
});

type Call = () => Promise<Response>;
const memberCalls: [string, Call][] = [
  ["GET /users/me", () => me.GET(json("GET", "/users/me"))],
  ["PATCH /users/me", () => me.PATCH(json("PATCH", "/users/me", { name: "New Name" }))],
  ["GET /visits", () => visits.GET(json("GET", "/visits"))],
  ["POST /visits", () => visits.POST(json("POST", "/visits", visitBody()))],
  [
    "POST /visits/sync",
    () => {
      const now = new Date().toISOString();
      const items = [{ ...visitBody(), clientCreatedAt: now, updatedAt: now }];
      return sync.POST(json("POST", "/visits/sync", { items, sentAt: now }));
    },
  ],
  ["GET /history/mine", () => mine.GET(json("GET", "/history/mine"))],
  ["GET /follow-ups", () => followUps.GET(json("GET", "/follow-ups"))],
  ["GET /blocks", () => blocksRoute.GET(json("GET", "/blocks"))],
];
const adminCalls: [string, Call][] = [
  ["GET /users", () => usersRoute.GET(json("GET", "/users"))],
  ["GET /history", () => allHistory.GET(json("GET", "/history"))],
  ["POST /sessions", () => sessionsRoute.POST(json("POST", "/sessions", { title: "Outing" }))],
];

const deleteUser = async () => {
  await pool.query("delete from session_blocks");
  await pool.query("delete from outing_sessions");
  await pool.query("delete from users where id = $1", [USER]);
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'u@t.local','User','admin')`,
    [USER],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'1','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Live','active',$2)`,
    [SESSION, USER],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: USER, role: "admin", deactivated: false } });
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("a deactivated account, holding the same token", () => {
  it.each([...memberCalls, ...adminCalls])(
    "%s works, then 403s once deactivated",
    async (_n, call) => {
      const first = await call();
      expect(first.status, await first.clone().text()).toBeLessThan(300);

      await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("account_deactivated");
    },
  );

  it("changes nothing when a deactivated account tries to write", async () => {
    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    await me.PATCH(json("PATCH", "/users/me", { name: "Hijack" }));
    await visits.POST(json("POST", "/visits", visitBody()));

    const { rows } = await pool.query<{ name: string; visits: string }>(
      "select name, (select count(*) from visits) as visits from users where id = $1",
      [USER],
    );
    expect(rows[0]).toEqual({ name: "User", visits: "0" });
  });

  it("works again once reactivated, without signing in again", async () => {
    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    expect((await me.GET(json("GET", "/users/me"))).status).toBe(403);

    await pool.query("update users set deactivated_at = null where id = $1", [USER]);
    expect((await me.GET(json("GET", "/users/me"))).status).toBe(200);
  });
});

describe("a demoted admin, holding the same token", () => {
  it.each(adminCalls)("%s is 403 forbidden once demoted", async (_n, call) => {
    const first = await call();
    expect(first.status, await first.clone().text()).toBeLessThan(300);

    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });

  it("is a member for scoped listings too", async () => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const other = "f1f1f1f1-0000-4000-8000-000000000002";
    expect((await visits.GET(json("GET", `/visits?memberId=${other}`))).status).toBe(403);
  });

  it("is hidden the admin pages", async () => {
    await expect(requireAdminPage()).resolves.toBeUndefined();

    await pool.query("update users set role = 'member' where id = $1", [USER]);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the admin pages from a deactivated admin, and restores them on reactivation", async () => {
    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await pool.query("update users set deactivated_at = null where id = $1", [USER]);
    await expect(requireAdminPage()).resolves.toBeUndefined();
  });
});

describe("a promoted member, holding the same token", () => {
  it("gains admin rights immediately", async () => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    expect((await usersRoute.GET(json("GET", "/users"))).status).toBe(403);
    await pool.query("update users set role = 'admin' where id = $1", [USER]);
    expect((await usersRoute.GET(json("GET", "/users"))).status).toBe(200);
  });
});

describe("a deleted account, holding the same token", () => {
  it.each([...memberCalls, ...adminCalls])("%s is 401 unauthenticated", async (_n, call) => {
    await deleteUser();
    const response = await call();
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthenticated");
  });

  it("is hidden the admin pages", async () => {
    await deleteUser();
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("when the database lookup fails", () => {
  it("answers 500, never allowed", async () => {
    const { getPool } = await import("@/db/client");
    const live = getPool();
    const broken = vi.spyOn(live, "query").mockRejectedValue(new Error("connection lost"));
    try {
      const response = await usersRoute.GET(json("GET", "/users"));
      expect(response.status).toBe(500);
    } finally {
      broken.mockRestore();
    }
  });
});
