import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET, POST } = await import("./route");

const pool = createTestPool();
const ADMIN = "cacacaca-0000-4000-8000-000000000001";
const ALICE = "cacacaca-0000-4000-8000-000000000002";
const BEN = "cacacaca-0000-4000-8000-000000000003";
const GONE = "cacacaca-0000-4000-8000-000000000004";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asMember = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

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

describe("POST /api/users from a page on another origin (#121)", () => {
  /*
   * The audit's reproduction: a sibling subdomain posts text/plain, which needs
   * no preflight, and the SameSite=Lax cookie goes with it because the site is
   * the same. It created an admin.
   */
  const forged = (site: string, type = "text/plain") =>
    new Request("https://test.local/api/users", {
      method: "POST",
      body: JSON.stringify({ email: "mallory@t.local", password: "correct horse", role: "admin" }),
      headers: { "content-type": type, "sec-fetch-site": site },
    });
  const count = async () => {
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
    return Number(rows[0]?.n);
  };

  it("refuses it from a sibling site, before looking at the session", async () => {
    asAdmin();
    const before = await count();

    const response = await POST(forged("same-site"));

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(auth).not.toHaveBeenCalled();
    expect(await count()).toBe(before);
  });

  it("refuses the text/plain body even from the app's own origin", async () => {
    asAdmin();
    const before = await count();

    const response = await POST(forged("same-origin"));

    expect(response.status).toBe(415);
    expect(await count()).toBe(before);
  });

  it("creates the account when the app itself sends that body as JSON", async () => {
    // So the refusals above are about how the request came, not what it asked for.
    asAdmin();
    const before = await count();

    const response = await POST(forged("same-origin", "application/json"));

    expect(response.status).toBe(201);
    expect(await count()).toBe(before + 1);
  });
});
