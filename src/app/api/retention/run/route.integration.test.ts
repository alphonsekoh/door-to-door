import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

/*
 * The scheduler's trigger (#279): only its bearer secret opens it, and
 * nothing is read or erased for a call that lacks it.
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./route");

const pool = createTestPool();
const ADMIN = "27927902-0000-4000-8000-000000000001";
const BLOCK = "27927902-0000-4000-8001-000000000001";
const H1 = "27927902-0000-4000-8003-000000000001";

const run = (authorization?: string) =>
  GET(
    new Request("https://test.local/api/retention/run", {
      ...(authorization === undefined ? {} : { headers: { authorization } }),
    }),
  );

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','A','admin')`,
    [ADMIN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'1','Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, name, created_at)
     VALUES ($1,$2,'#01-01','Mr Tan','2020-01-01T00:00:00Z')`,
    [H1, BLOCK],
  );
  vi.stubEnv("CRON_SECRET", "a-secret-of-some-length");
  vi.clearAllMocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
  await resetDatabase();
});

const runs = async () =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM retention_runs`)).rows[0]?.n);

describe("GET /api/retention/run", () => {
  it("runs for the scheduler, reads no session, and reports what it did", async () => {
    const response = await run("Bearer a-secret-of-some-length");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      households: 1,
      accounts: 0,
      signIns: 0,
      more: false,
    });
    expect(auth).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["no bearer", undefined],
    ["a wrong one", "Bearer wrong"],
  ])("answers 401 to %s, and touches nothing", async (_case, header) => {
    const response = await run(header);
    expect(response.status).toBe(401);
    expect(await runs()).toBe(0);
    expect(
      (await pool.query<{ name: string | null }>(`SELECT name FROM households WHERE id = $1`, [H1]))
        .rows[0]?.name,
    ).toBe("Mr Tan");
  });

  it("answers 401 when no secret is configured, even to an empty bearer", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await run("Bearer ")).status).toBe(401);
    expect(await runs()).toBe(0);
  });

  it("answers 409 while another run is under way", async () => {
    await pool.query(`INSERT INTO retention_runs (started_at) VALUES (now())`);
    expect((await run("Bearer a-secret-of-some-length")).status).toBe(409);
  });
});
