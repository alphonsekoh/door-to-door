import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getDatabase, getPool, resetDatabase } from "@/db/client";

const URL = "postgresql://postgres:postgres@localhost:5432/nowhere";

/* drizzle() keeps the pool it runs on as $client; Database leaves it out so a
   transaction still fits where a client is expected. */
const clientOf = (db: object): unknown => Reflect.get(db, "$client");

const { getConfig, attachDatabasePool } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  attachDatabasePool: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig }));
// What it does with the pool, on Vercel and off it, is in client.integration.test.ts.
vi.mock("@vercel/functions/db-connections", () => ({ attachDatabasePool }));

beforeEach(() => {
  getConfig.mockReturnValue({ databaseUrl: URL });
});

afterEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe("createDatabase", () => {
  it("builds a pool for the URL, and a client on that pool, without connecting", () => {
    // Creating a Pool opens no socket, which is why this needs no database.
    const { pool, db } = createDatabase(URL);
    expect(pool.options.connectionString).toBe(URL);
    expect(pool.totalCount).toBe(0);
    expect(pool.listenerCount("error")).toBe(1);
    expect(clientOf(db)).toBe(pool);
    return pool.end();
  });

  it("sizes the pool for one serverless instance: ten connections, each closed after 5 s idle", () => {
    const { pool } = createDatabase(URL);
    expect(pool.options).toMatchObject({ max: 10, idleTimeoutMillis: 5_000 });
    return pool.end();
  });

  it("hands the pool to Vercel, so an instance is not suspended holding idle connections", () => {
    const { pool } = createDatabase(URL);
    expect(attachDatabasePool).toHaveBeenCalledExactlyOnceWith(pool);
    return pool.end();
  });
});

describe("getDatabase", () => {
  it("listens for pool errors so a dead idle client cannot crash the process", () => {
    expect(getPool().listenerCount("error")).toBe(1);
  });

  it("shares one pool across module graphs, handed to Vercel once", async () => {
    const first = getPool();
    vi.resetModules();
    const again = await import("@/db/client");
    expect(again.getPool()).toBe(first);
    expect(attachDatabasePool).toHaveBeenCalledExactlyOnceWith(first);
  });

  it("reuses one client per process", () => {
    expect(getDatabase()).toBe(getDatabase());
  });

  it("shares the pool with the client", () => {
    expect(clientOf(getDatabase())).toBe(getPool());
  });

  it("creates the pool on first access via getPool too, and the client then uses it", () => {
    const pool = getPool();
    expect(pool.options.connectionString).toBe(URL);
    expect(clientOf(getDatabase())).toBe(pool);
  });

  it("connects with the URL composed from config and credentials", () => {
    getConfig.mockReturnValue({ databaseUrl: "postgresql://app:s3cret@db:5432/prod" });
    expect(getPool().options.connectionString).toBe("postgresql://app:s3cret@db:5432/prod");
  });

  it("lets a configuration error through rather than connecting somewhere else", () => {
    getConfig.mockImplementation(() => {
      throw new Error("bad config");
    });
    expect(() => getDatabase()).toThrow("bad config");
  });
});

describe("resetDatabase", () => {
  it("closes the pool and forces a new one", async () => {
    const first = getDatabase();
    await resetDatabase();
    expect(getDatabase()).not.toBe(first);
  });

  it("is safe when nothing was created", async () => {
    await expect(resetDatabase()).resolves.toBeUndefined();
  });
});
