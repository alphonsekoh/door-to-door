import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getDatabase, getPool, resetDatabase } from "@/db/client";

const URL = "postgresql://postgres:postgres@localhost:5432/nowhere";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

beforeEach(() => {
  getConfig.mockReturnValue({ databaseUrl: URL });
});

afterEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe("createDatabase", () => {
  it("builds a pool and a typed client without connecting", () => {
    // Creating a Pool opens no socket, which is why this needs no database.
    const { pool, db } = createDatabase(URL);
    expect(pool).toBeDefined();
    expect(db).toBeDefined();
    return pool.end();
  });
});

describe("getDatabase", () => {
  it("reuses one client per process", () => {
    expect(getDatabase()).toBe(getDatabase());
  });

  it("shares the pool with the client", () => {
    getDatabase();
    expect(getPool()).toBe(getPool());
  });

  it("creates the pool on first access via getPool too", () => {
    expect(getPool()).toBeDefined();
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
