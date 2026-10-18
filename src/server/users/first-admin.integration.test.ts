import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { attachPoolErrorHandler } from "@/db/pool-errors";
import * as schema from "@/db/schema";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { truncateAll } from "@/db/testing";
import { authorizeCredentials } from "@/server/auth/credentials";
import { createRateLimiter } from "@/server/auth/rate-limit";
import {
  ADMIN_EXISTS_MESSAGE,
  CreateAdminError,
  adminExists,
  createFirstAdmin,
} from "@/server/users/first-admin";

/* Room for two transactions at once, which the race test needs. */
const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 4 });
attachPoolErrorHandler(pool);
const db = drizzle(pool, { schema }) as unknown as Database;

const INPUT = { email: "Lead@Example.org", name: "Lead", password: "correct-horse" };

async function snapshotUsers() {
  const { rows } = await pool.query<{ email: string; role: string; password_hash: string | null }>(
    "SELECT email, role, password_hash FROM users ORDER BY email",
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("createFirstAdmin on an empty database", () => {
  it("creates one active admin who can sign in with the chosen password", async () => {
    const created = await createFirstAdmin(db, INPUT);

    expect(created.email).toBe("lead@example.org");
    const { rows } = await pool.query(
      "SELECT role, name, deactivated_at FROM users WHERE id = $1",
      [created.id],
    );
    expect(rows).toEqual([{ role: "admin", name: "Lead", deactivated_at: null }]);

    // Through the real sign-in path, so the hash is proven to be what it verifies.
    const signedIn = await authorizeCredentials(
      { email: "lead@example.org", password: "correct-horse" },
      { db, limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }) },
    );
    expect(signedIn).toMatchObject({ id: created.id, role: "admin", deactivatedAt: null });
  });

  it("stores an argon2id hash, never the password", async () => {
    await createFirstAdmin(db, INPUT);
    const [row] = await snapshotUsers();
    expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    expect(row?.password_hash).not.toContain("correct-horse");
  });

  it("leaves the name empty when none is given", async () => {
    const created = await createFirstAdmin(db, { ...INPUT, name: null });
    const { rows } = await pool.query("SELECT name FROM users WHERE id = $1", [created.id]);
    expect(rows).toEqual([{ name: null }]);
  });
});

describe("createFirstAdmin refusals", () => {
  it("refuses and changes nothing when an admin already exists", async () => {
    await pool.query(
      "INSERT INTO users (email, role, password_hash) VALUES ('first@t.local', 'admin', 'h')",
    );
    const before = await snapshotUsers();

    await expect(createFirstAdmin(db, INPUT)).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(await snapshotUsers()).toEqual(before);
  });

  it("counts a deactivated admin, so it can never add a second one", async () => {
    await pool.query(
      "INSERT INTO users (email, role, deactivated_at) VALUES ('gone@t.local', 'admin', now())",
    );
    await expect(createFirstAdmin(db, INPUT)).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(await snapshotUsers()).toHaveLength(1);
  });

  it("does not count members as admins", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('member@t.local', 'member')");
    expect(await adminExists(db)).toBe(false);
    await expect(createFirstAdmin(db, INPUT)).resolves.toMatchObject({
      email: "lead@example.org",
    });
  });

  it("refuses an email that already belongs to a member, leaving them as they were", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('lead@example.org', 'member')");
    const before = await snapshotUsers();

    const refusal = createFirstAdmin(db, INPUT);
    await expect(refusal).rejects.toBeInstanceOf(CreateAdminError);
    await expect(refusal).rejects.toThrow(
      "lead@example.org already belongs to an account, so nothing was changed.",
    );
    expect(await snapshotUsers()).toEqual(before);
  });

  it("creates exactly one admin when two runs race", async () => {
    const results = await Promise.allSettled([
      createFirstAdmin(db, { ...INPUT, email: "one@example.org" }),
      createFirstAdmin(db, { ...INPUT, email: "two@example.org" }),
      createFirstAdmin(db, { ...INPUT, email: "three@example.org" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect(result.reason).toBeInstanceOf(CreateAdminError);
    }
    const admins = (await snapshotUsers()).filter((row) => row.role === "admin");
    expect(admins).toHaveLength(1);
  });
});
