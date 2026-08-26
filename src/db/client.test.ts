import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getDatabase, getPool, resetDatabase } from "@/db/client";
import { MissingDatabaseUrlError } from "@/db/env";

const URL = "postgresql://postgres:postgres@localhost:5432/nowhere";

afterEach(async () => {
  await resetDatabase();
  vi.unstubAllEnvs();
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
    vi.stubEnv("DATABASE_URL", URL);
    expect(getDatabase()).toBe(getDatabase());
  });

  it("shares the pool with the client", () => {
    vi.stubEnv("DATABASE_URL", URL);
    getDatabase();
    expect(getPool()).toBe(getPool());
  });

  it("creates the pool on first access via getPool too", () => {
    vi.stubEnv("DATABASE_URL", URL);
    expect(getPool()).toBeDefined();
  });

  it("fails clearly when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getDatabase()).toThrow(MissingDatabaseUrlError);
  });
});

describe("resetDatabase", () => {
  it("closes the pool and forces a new one", async () => {
    vi.stubEnv("DATABASE_URL", URL);
    const first = getDatabase();
    await resetDatabase();
    expect(getDatabase()).not.toBe(first);
  });

  it("is safe when nothing was created", async () => {
    await expect(resetDatabase()).resolves.toBeUndefined();
  });
});
