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
  CREATE_ADMIN_LOCK,
  CreateAdminError,
  adminExists,
  createFirstAdmin,
} from "@/server/users/first-admin";

/* Room for the lock holder, the blocked run and the poller at once. */
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

  it("waits on the lock, so an admin created meanwhile makes it refuse", async () => {
    // Two runs racing only overlap by chance, so the interleaving is forced:
    // hold the lock, let a run block on it, create an admin, then release.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CREATE_ADMIN_LOCK]);

      const run = createFirstAdmin(db, INPUT);
      run.catch(() => undefined);

      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        // Only this database's waiter on this key, so another suite on the shared
        // server cannot satisfy it. A bigint key is split into classid (high 32
        // bits) and objid (low 32 bits), with objsubid 1.
        const { rows } = await pool.query<{ count: string }>(
          `WITH k AS (SELECT hashtext($1)::bigint AS key)
           SELECT count(*) FROM pg_locks, k
           WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
             AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
             AND classid::bigint = (k.key >> 32) & 4294967295
             AND objid::bigint = k.key & 4294967295`,
          [CREATE_ADMIN_LOCK],
        );
        waiting = rows[0]?.count !== "0";
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);

      await holder.query(
        "INSERT INTO users (email, role, password_hash) VALUES ('first@t.local', 'admin', 'h')",
      );
      await holder.query("COMMIT");

      await expect(run).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
      const admins = (await snapshotUsers()).filter((row) => row.role === "admin");
      expect(admins.map((row) => row.email)).toEqual(["first@t.local"]);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });
});
