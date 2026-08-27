import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { POST } = await import("./route");

const pool = createTestPool();
const ADMIN = "fafafafa-0000-4000-8000-000000000001";
const ALICE = "fafafafa-0000-4000-8000-000000000002";
const BLOCK = "fafafafa-0000-4000-8001-000000000001";
const SESSION = "fafafafa-0000-4000-8002-000000000001";

const asAlice = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

let seq = 0;
const nextId = () => `01960000-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

const item = (overrides: Record<string, unknown> = {}) => ({
  id: nextId(),
  blockId: BLOCK,
  unitNumber: "#05-123",
  interestLevel: "low",
  clientCreatedAt: "2026-03-14T10:00:00.000Z",
  updatedAt: "2026-03-14T10:00:00.000Z",
  ...overrides,
});

const sync = (body: unknown) =>
  POST(
    new Request("https://test.local/api/visits/sync", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(async () => {
  seq = 0;
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Outing','active',$2)`,
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

describe("POST /api/visits/sync", () => {
  it("flushes a batch and reports each result", async () => {
    asAlice();
    const response = await sync({ items: [item(), item({ unitNumber: "#06-201" })] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { status: string; visit: unknown }[] };
    expect(body.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(body.results[0]?.visit).not.toBeNull();
  });

  it("returns 200 even when an item is rejected", async () => {
    /*
     * Partial success is the norm. A 200 does not mean everything applied -
     * the client inspects each result.
     */
    asAlice();
    const response = await sync({
      items: [item(), item({ blockId: "fafafafa-0000-4000-8001-00000000ffff" })],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: { status: string; error: { error: { code: string } } | null }[];
    };
    expect(body.results.map((r) => r.status)).toEqual(["applied", "rejected"]);
    expect(body.results[1]?.error?.error.code).toBe("not_found");
  });

  it("rejects an empty batch with 400", async () => {
    asAlice();
    expect((await sync({ items: [] })).status).toBe(400);
  });

  it("rejects a batch beyond the documented limit", async () => {
    // Bounded so one client cannot flush an unbounded queue in one request.
    asAlice();
    const items = Array.from({ length: 101 }, () => item());
    expect((await sync({ items })).status).toBe(400);
  });

  it("accepts a batch at exactly the limit", async () => {
    asAlice();
    const items = Array.from({ length: 100 }, (_, i) => item({ unitNumber: `#01-${String(i)}` }));
    expect((await sync({ items })).status).toBe(200);
  });

  it("rejects an item missing updatedAt, which decides last-write-wins", async () => {
    asAlice();
    const { updatedAt: _omitted, ...withoutUpdatedAt } = item();
    const response = await sync({ items: [withoutUpdatedAt] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.some((d) => d.path.includes("updatedAt"))).toBe(true);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await sync({ items: [item()] })).status).toBe(401);
  });

  it("refuses a deactivated account", async () => {
    auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: true } });
    expect((await sync({ items: [item()] })).status).toBe(403);
  });

  it("rate limits a client stuck in a retry loop", async () => {
    asAlice();
    let lastStatus = 200;
    // The limiter allows 30 flushes a minute per member.
    for (let i = 0; i < 32; i += 1) {
      lastStatus = (await sync({ items: [item()] })).status;
    }
    expect(lastStatus).toBe(429);
  });
});
