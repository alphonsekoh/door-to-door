import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { GET, POST } = await import("./route");
const { PATCH } = await import("./[id]/route");

const pool = createTestPool();
const ADMIN = "abababab-0000-4000-8000-000000000001";
const MEMBER = "abababab-0000-4000-8000-000000000002";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: MEMBER, role: "member", deactivated: false } });

const url = (q = "") => `https://test.local/api/blocks${q}`;
const json = (body: unknown, method: string) =>
  new Request(url(), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const create = (body: unknown) => POST(json(body, "POST"));
const patch = (id: string, body: unknown) =>
  PATCH(json(body, "PATCH"), { params: Promise.resolve({ id }) });

async function createBlock(name: string, street = "Test Ave"): Promise<string> {
  asAdmin();
  const body = (await (await create({ name, street })).json()) as { id: string };
  return body.id;
}

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

describe("POST /api/blocks", () => {
  it("creates a block", async () => {
    asAdmin();
    const response = await create({
      name: "123",
      street: "Ang Mo Kio Ave 3",
      postalCode: "560123",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "123", street: "Ang Mo Kio Ave 3" });
  });

  it("refuses a member", async () => {
    asMember();
    expect((await create({ name: "123", street: "Ave" })).status).toBe(403);
  });

  it("returns 409 for a duplicate rather than a second row", async () => {
    // Two entries for one block would split its history in half.
    await createBlock("123");
    asAdmin();
    const response = await create({ name: "123", street: "Test Ave" });
    expect(response.status).toBe(409);

    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM blocks`);
    expect(rows[0]?.count).toBe("1");
  });

  it("allows the same number on a different street", async () => {
    await createBlock("123", "Ang Mo Kio Ave 3");
    asAdmin();
    expect((await create({ name: "123", street: "Bedok North Ave 1" })).status).toBe(201);
  });

  it("trims surrounding whitespace, so a stray space is not a new block", async () => {
    await createBlock("123");
    asAdmin();
    expect((await create({ name: "  123  ", street: "  Test Ave  " })).status).toBe(409);
  });

  it("rejects a missing street with 400", async () => {
    asAdmin();
    const response = await create({ name: "123" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toContain("/street");
  });
});

describe("GET /api/blocks", () => {
  it("is readable by members, who pick blocks from it", async () => {
    await createBlock("123");
    asMember();
    const response = await GET(new Request(url()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it("finds a block by a partial number", async () => {
    await createBlock("1234");
    asMember();
    const body = (await (await GET(new Request(url("?search=23")))).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("searches the street too, case-insensitively", async () => {
    await createBlock("123", "Ang Mo Kio Ave 3");
    asMember();
    const body = (await (await GET(new Request(url("?search=ANG mo")))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(1);
  });

  it("returns nothing for a search that matches nothing", async () => {
    await createBlock("123");
    asMember();
    const body = (await (await GET(new Request(url("?search=zzz")))).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it("ignores a blank search rather than matching nothing", async () => {
    await createBlock("123");
    asMember();
    const body = (await (await GET(new Request(url("?search=%20")))).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("paginates", async () => {
    await createBlock("123");
    await createBlock("125");
    asMember();
    const body = (await (await GET(new Request(url("?limit=1")))).json()) as {
      data: unknown[];
      pagination: { hasMore: boolean; total: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 2, hasMore: true });
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(new Request(url()))).status).toBe(401);
  });
});

describe("PATCH /api/blocks/{id}", () => {
  it("amends a block", async () => {
    const id = await createBlock("123");
    asAdmin();
    const response = await patch(id, { street: "Corrected Ave" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "123", street: "Corrected Ave" });
  });

  it("clears a postal code when sent null", async () => {
    const id = await createBlock("123");
    asAdmin();
    const body = (await (await patch(id, { postalCode: null })).json()) as {
      postalCode: string | null;
    };
    expect(body.postalCode).toBeNull();
  });

  it("returns 409 when the change would duplicate another block", async () => {
    await createBlock("123");
    const second = await createBlock("125");
    asAdmin();
    expect((await patch(second, { name: "123" })).status).toBe(409);
  });

  it("returns 404 for a block that does not exist", async () => {
    asAdmin();
    expect((await patch("abababab-0000-4000-8001-00000000ffff", { name: "9" })).status).toBe(404);
  });

  it("refuses a member", async () => {
    const id = await createBlock("123");
    asMember();
    expect((await patch(id, { name: "999" })).status).toBe(403);
  });

  it("rejects an empty change with 400", async () => {
    const id = await createBlock("123");
    asAdmin();
    expect((await patch(id, {})).status).toBe(400);
  });
});
