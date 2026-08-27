import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { GET, POST } = await import("./route");

const pool = createTestPool();
const ADMIN = "eeeeeeee-0000-4000-8000-000000000001";
const MEMBER = "eeeeeeee-0000-4000-8000-000000000002";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: MEMBER, role: "member", deactivated: false } });

const list = (query = "") => new Request(`https://test.local/api/sessions${query}`);
const create = (body: unknown) =>
  new Request("https://test.local/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','Admin','admin'), ($2,'m@t.local','Member','member')`,
    [ADMIN, MEMBER],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("authorization", () => {
  it("refuses a member listing sessions", async () => {
    /*
     * The acceptance criterion. This calls the handler directly, bypassing the
     * proxy entirely, which is what proves the handler enforces it itself.
     */
    asMember();
    const response = await GET(list());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("refuses a member creating a session", async () => {
    asMember();
    expect((await POST(create({ title: "Sneaky" }))).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(list())).status).toBe(401);
  });

  it("refuses a deactivated admin", async () => {
    auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: true } });
    expect((await GET(list())).status).toBe(403);
  });
});

describe("POST /api/sessions", () => {
  it("creates a draft", async () => {
    asAdmin();
    const response = await POST(create({ title: "March outing" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { title: string; status: string };
    expect(body).toMatchObject({ title: "March outing", status: "draft" });
  });

  it("rejects a missing title with 400", async () => {
    asAdmin();
    const response = await POST(create({}));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toContain("/title");
  });

  it("rejects an unknown block with 404", async () => {
    asAdmin();
    const response = await POST(
      create({ title: "Outing", blockIds: ["eeeeeeee-0000-4000-8001-00000000ffff"] }),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  it("returns a paginated envelope", async () => {
    asAdmin();
    await POST(create({ title: "One" }));
    const body = (await (await GET(list())).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 1, hasMore: false });
  });

  it("reports hasMore when a page is cut short", async () => {
    asAdmin();
    await POST(create({ title: "One" }));
    await POST(create({ title: "Two" }));
    const body = (await (await GET(list("?limit=1"))).json()) as {
      pagination: { hasMore: boolean };
    };
    expect(body.pagination.hasMore).toBe(true);
  });

  it("rejects a limit beyond the documented maximum", async () => {
    // Genuinely out of range now that numeric params are coerced - before the
    // fix this passed because "500" was rejected as a string.
    asAdmin();
    const response = await GET(list("?limit=500"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toContain("/limit");
  });

  it("accepts a limit within range", async () => {
    asAdmin();
    expect((await GET(list("?limit=10&offset=0"))).status).toBe(200);
  });

  it("filters by status", async () => {
    asAdmin();
    await POST(create({ title: "Draft one" }));
    const body = (await (await GET(list("?status=active"))).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });
});
