import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./[id]/revisits/route");

const pool = createTestPool();
const ADMIN = "d1d1d1d1-0000-4000-8000-000000000001";
const ALICE = "d1d1d1d1-0000-4000-8000-000000000002";
const BLOCK = "d1d1d1d1-0000-4000-8001-000000000001";
const HOUSEHOLD = "d1d1d1d1-0000-4000-8003-000000000001";
const SESSION = "d1d1d1d1-0000-4000-8002-000000000001";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asAlice = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

const call = (id = SESSION) =>
  GET(new Request(`https://test.local/api/sessions/${id}/revisits`), {
    params: Promise.resolve({ id }),
  });

const session = async (kind: "regular" | "follow_up", status: "draft" | "active" | "ended") => {
  const startedAt = status === "draft" ? null : new Date(Date.now() - 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, kind, status, started_at, created_by)
     VALUES ($1,'Tonight',$2,$3,$4,$5)`,
    [SESSION, kind, status, startedAt, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, name) VALUES ($1,$2,'#05-123','Mr Tan')`,
    [HOUSEHOLD, BLOCK],
  );
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, note, listed_at, listed_by)
     VALUES ($1,$2,'Bring the flyer', now(), $2)`,
    [HOUSEHOLD, ADMIN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("GET /api/sessions/{id}/revisits", () => {
  it("gives a member the running follow-up session's list", async () => {
    await session("follow_up", "active");
    asAlice();
    const response = await call();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      household: { unitNumber: "#05-123", name: "Mr Tan" },
      block: { name: "123" },
      notes: [{ note: "Bring the flyer", status: "listed", listedBy: { name: "Admin" } }],
      latestVisit: null,
      visitedInSession: false,
    });
  });

  it("carries the latest visit and whether it was made in this session", async () => {
    await session("follow_up", "active");
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ('01960000-0000-7000-8000-0000000d1d01',$1,$2,$3,'high')`,
      [HOUSEHOLD, SESSION, ALICE],
    );
    asAlice();
    const body = (await (await call()).json()) as {
      data: { latestVisit: { member: { name: string } } | null; visitedInSession: boolean }[];
    };
    expect(body.data[0]).toMatchObject({
      latestVisit: { member: { name: "Alice" } },
      visitedInSession: true,
    });
  });

  it("lets an admin check a draft's list before starting it", async () => {
    await session("follow_up", "draft");
    asAdmin();
    expect((await call()).status).toBe(200);
  });

  it("lets an admin read an ended session's list", async () => {
    await session("follow_up", "ended");
    asAdmin();
    expect((await call()).status).toBe(200);
  });

  it("refuses a member a draft's list", async () => {
    await session("follow_up", "draft");
    asAlice();
    expect((await call()).status).toBe(403);
  });

  it("refuses a member an ended session's list", async () => {
    await session("follow_up", "ended");
    asAlice();
    expect((await call()).status).toBe(403);
  });

  it("says a regular session has no list", async () => {
    await session("regular", "active");
    asAlice();
    const response = await call();
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({
      code: "conflict",
      message: "This is a regular session, so it has no follow-up list.",
    });
  });

  it("refuses 404 before anything else for an unknown session", async () => {
    asAlice();
    expect((await call("d1d1d1d1-0000-4000-8002-00000000ffff")).status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    await session("follow_up", "active");
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
