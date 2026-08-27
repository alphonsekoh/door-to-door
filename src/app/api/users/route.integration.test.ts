import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { GET } = await import("./route");

const pool = createTestPool();
const ADMIN = "cacacaca-0000-4000-8000-000000000001";
const ALICE = "cacacaca-0000-4000-8000-000000000002";
const BEN = "cacacaca-0000-4000-8000-000000000003";
const GONE = "cacacaca-0000-4000-8000-000000000004";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

const call = (q = "") => GET(new Request(`https://test.local/api/users${q}`));

type Listed = { id: string; name: string | null; role: string; deactivatedAt: string | null };
const listed = async (response: Response) => ((await response.json()) as { data: Listed[] }).data;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role, deactivated_at) VALUES
      ($1,'admin@t.local','Admin','admin',null),
      ($2,'alice@t.local','Alice','member',null),
      ($3,'ben@t.local','Ben','member',null),
      ($4,'gone@t.local','Gone','member',now())`,
    [ADMIN, ALICE, BEN, GONE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("GET /api/users", () => {
  it("refuses a member", async () => {
    // It exposes email addresses and who has been deactivated.
    asMember();
    expect((await call()).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("lists the active team alphabetically", async () => {
    asAdmin();
    expect((await listed(await call())).map((user) => user.name)).toEqual([
      "Admin",
      "Alice",
      "Ben",
    ]);
  });

  it("leaves out deactivated users by default", async () => {
    // They stay in the database so their records keep their author.
    asAdmin();
    expect((await listed(await call())).map((user) => user.name)).not.toContain("Gone");
  });

  it("includes them when asked", async () => {
    asAdmin();
    const data = await listed(await call("?includeDeactivated=true"));
    expect(data.map((user) => user.name)).toContain("Gone");
    expect(data.find((user) => user.name === "Gone")?.deactivatedAt).not.toBeNull();
  });

  it("filters by role", async () => {
    asAdmin();
    const data = await listed(await call("?role=member"));
    expect(data.map((user) => user.name)).toEqual(["Alice", "Ben"]);
  });

  it("counts what the filter matched, not the whole table", async () => {
    asAdmin();
    const body = (await (await call("?role=admin")).json()) as {
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.pagination).toMatchObject({ total: 1, hasMore: false });
  });

  it("paginates", async () => {
    asAdmin();
    const body = (await (await call("?limit=2")).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({ total: 3, hasMore: true });
  });

  it("rejects a role outside the contract", async () => {
    asAdmin();
    expect((await call("?role=superuser")).status).toBe(400);
  });
});
