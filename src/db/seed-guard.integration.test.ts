import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SeedRefusedError, seedTarget } from "@/db/seed-guard";
import { seedAdmin, seedBlocks, seedUsers } from "@/db/seed-data";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { createTestPool, truncateAll } from "@/db/testing";
import { seedDatabase } from "../../scripts/seed";

/*
 * The seed against a real database (#124): it fills an empty one or one
 * holding only its own users, and refuses, writing nothing, any database
 * where someone else has an account.
 */

const pool: Pool = createTestPool();
const url = requireTestDatabaseUrl();

const REAL_USER = "cccccccc-0000-4000-8000-000000000001";
const REAL_EMAIL = "organiser@church.example.org";

const count = async (table: "users" | "blocks"): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
};

const seedAdminRows = async (): Promise<number> => {
  const { rowCount } = await pool.query("SELECT 1 FROM users WHERE id = $1 OR email = $2", [
    seedAdmin.id,
    seedAdmin.email,
  ]);
  return rowCount ?? 0;
};

const insertRealUser = () =>
  pool.query(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Organiser', 'admin')`, [
    REAL_USER,
    REAL_EMAIL,
  ]);

beforeEach(async () => {
  await truncateAll(pool);
  // The seed reports its counts; nothing here reads them.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
});

describe("seedDatabase", () => {
  it("seeds an empty database", async () => {
    await seedDatabase(url);

    expect(await count("users")).toBe(seedUsers.length);
    expect(await count("blocks")).toBe(seedBlocks.length);
    expect(await seedAdminRows()).toBe(1);
  });

  it("runs again over its own users, changing nothing", async () => {
    await seedDatabase(url);
    await seedDatabase(url);

    expect(await count("users")).toBe(seedUsers.length);
    expect(await seedAdminRows()).toBe(1);
  });

  it("refuses a database with a user of its own, and writes nothing", async () => {
    await insertRealUser();

    const refusal = seedDatabase(url);
    await expect(refusal).rejects.toThrow(SeedRefusedError);
    await expect(refusal).rejects.toThrow(`Refusing to seed ${seedTarget(url)}: it has users`);

    expect(await count("users")).toBe(1);
    expect(await count("blocks")).toBe(0);
    expect(await seedAdminRows()).toBe(0);
  });

  it("refuses a demo database once someone has been added to it", async () => {
    await seedDatabase(url);
    await insertRealUser();

    await expect(seedDatabase(url)).rejects.toThrow(SeedRefusedError);
    expect(await count("users")).toBe(seedUsers.length + 1);
  });

  it("names no account in its refusal", async () => {
    await insertRealUser();

    const error: unknown = await seedDatabase(url).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SeedRefusedError);
    expect((error as Error).message).not.toContain(REAL_EMAIL);
    expect((error as Error).message).not.toContain(REAL_USER);
    expect((error as Error).message).not.toMatch(/postgres:postgres|@/);
  });
});
