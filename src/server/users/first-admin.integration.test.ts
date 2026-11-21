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
  pendingRequestMessage,
} from "@/server/users/first-admin";
import { createAccessRequest } from "@/server/users/service";

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
    const created = await createFirstAdmin(db, INPUT, null);

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
    await createFirstAdmin(db, INPUT, null);
    const [row] = await snapshotUsers();
    expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    expect(row?.password_hash).not.toContain("correct-horse");
  });

  it("stores no hash for an admin who signs in with Google only (#14)", async () => {
    const created = await createFirstAdmin(db, { ...INPUT, password: null }, ["example.org"]);
    expect(created).toMatchObject({ email: "lead@example.org", googleOnly: true });
    expect(await snapshotUsers()).toEqual([
      { email: "lead@example.org", role: "admin", password_hash: null },
    ]);
  });

  it("leaves the name empty when none is given", async () => {
    const created = await createFirstAdmin(db, { ...INPUT, name: null }, null);
    const { rows } = await pool.query("SELECT name FROM users WHERE id = $1", [created.id]);
    expect(rows).toEqual([{ name: null }]);
  });
});

/*
 * On a fresh database the would-be admin may try Google before running
 * create-admin, which asks to join (#249) with no admin to approve it. The
 * script still only ever creates (D-105-4), so it refuses and says the way out.
 */
describe("createFirstAdmin at an address that asked to join with Google", () => {
  const GOOGLE_ADDRESS = "lead@gmail.com";

  /* With its Google link and a sign-in on the phone it asked from. */
  async function askToJoin(email = GOOGLE_ADDRESS) {
    const request = await createAccessRequest(db, { email, name: "Name From Google" });
    if (request === null) throw new Error("the request was not made");
    await pool.query(
      "INSERT INTO accounts (user_id, type, provider, provider_account_id) VALUES ($1, 'oidc', 'google', $2)",
      [request.id, `google-${email}`],
    );
    await pool.query("INSERT INTO sign_ins (user_id) VALUES ($1)", [request.id]);
    return request;
  }

  async function account(id: string) {
    const { rows } = await pool.query<{
      role: string;
      approval: string;
      name: string | null;
      password_hash: string | null;
    }>("SELECT role, approval, name, password_hash FROM users WHERE id = $1", [id]);
    return rows;
  }

  async function linksAndSignIns() {
    const { rows } = await pool.query<{ accounts: number; sign_ins: number }>(
      "SELECT (SELECT count(*) FROM accounts)::int AS accounts, (SELECT count(*) FROM sign_ins)::int AS sign_ins",
    );
    return rows;
  }

  async function refusalOf(run: Promise<unknown>): Promise<CreateAdminError> {
    const error = await run.then(
      () => undefined,
      (refused: unknown) => refused,
    );
    if (!(error instanceof CreateAdminError)) throw new Error("it was not refused");
    return error;
  }

  it("refuses, naming the request and the way out, and leaves it as it was", async () => {
    const request = await askToJoin();

    const refusal = await refusalOf(
      createFirstAdmin(db, { email: "Lead@Gmail.com", name: "Lead", password: "correct-horse" }, [
        "gmail.com",
      ]),
    );

    expect(refusal.message).toBe(
      "lead@gmail.com has asked to join with Google and is waiting for approval, so nothing " +
        "was changed: this script only creates accounts. Delete the request and run this " +
        "again (DELETE FROM users WHERE email = 'lead@gmail.com' AND approval = 'pending';), " +
        "or make the first admin at another address and approve the request on Admin > Team.",
    );
    expect(await account(request.id)).toEqual([
      { role: "member", approval: "pending", name: "Name From Google", password_hash: null },
    ]);
    expect(await snapshotUsers()).toHaveLength(1);
    expect(await linksAndSignIns()).toEqual([{ accounts: 1, sign_ins: 1 }]);
  });

  it("gives a statement that clears the request whole, after which the admin is made", async () => {
    const email = "o'brien@gmail.com";
    await askToJoin(email);
    const google = { email, name: null, password: null };

    const refusal = await refusalOf(createFirstAdmin(db, google, ["gmail.com"]));
    expect(refusal.message).toBe(pendingRequestMessage(email));
    const statement = /\((DELETE FROM users .*;)\)/.exec(refusal.message)?.[1];
    if (statement === undefined) throw new Error("no statement in the refusal");
    await pool.query(statement);

    // Its Google link and its sign-in go with it, so that phone is signed out.
    expect(await snapshotUsers()).toEqual([]);
    expect(await linksAndSignIns()).toEqual([{ accounts: 0, sign_ins: 0 }]);
    await expect(createFirstAdmin(db, google, ["gmail.com"])).resolves.toMatchObject({
      email,
      googleOnly: true,
    });
    expect(await snapshotUsers()).toEqual([{ email, role: "admin", password_hash: null }]);
  });

  it("makes the admin at another address, leaving the request for it to approve", async () => {
    const request = await askToJoin();

    await createFirstAdmin(db, INPUT, null);

    expect(await account(request.id)).toMatchObject([{ role: "member", approval: "pending" }]);
  });

  it("never lets a request past the queue once an admin exists", async () => {
    await pool.query(
      "INSERT INTO users (email, role, password_hash) VALUES ('first@t.local', 'admin', 'h')",
    );
    const request = await askToJoin();

    await expect(
      createFirstAdmin(db, { email: GOOGLE_ADDRESS, name: null, password: null }, ["gmail.com"]),
    ).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(await account(request.id)).toMatchObject([{ role: "member", approval: "pending" }]);
  });

  it("refuses a rejected one as any other account, and changes nothing", async () => {
    const request = await askToJoin();
    await pool.query("UPDATE users SET approval = 'blocked' WHERE id = $1", [request.id]);

    await expect(
      createFirstAdmin(db, { email: GOOGLE_ADDRESS, name: null, password: null }, ["gmail.com"]),
    ).rejects.toThrow(`${GOOGLE_ADDRESS} already belongs to an account, so nothing was changed.`);
    expect(await account(request.id)).toMatchObject([{ role: "member", approval: "blocked" }]);
  });
});

describe("createFirstAdmin refusals", () => {
  it("refuses and changes nothing when an admin already exists", async () => {
    await pool.query(
      "INSERT INTO users (email, role, password_hash) VALUES ('first@t.local', 'admin', 'h')",
    );
    const before = await snapshotUsers();

    await expect(createFirstAdmin(db, INPUT, null)).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(await snapshotUsers()).toEqual(before);
  });

  it("counts a deactivated admin, so it can never add a second one", async () => {
    await pool.query(
      "INSERT INTO users (email, role, deactivated_at) VALUES ('gone@t.local', 'admin', now())",
    );
    await expect(createFirstAdmin(db, INPUT, null)).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(await snapshotUsers()).toHaveLength(1);
  });

  it("does not count members as admins", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('member@t.local', 'member')");
    expect(await adminExists(db)).toBe(false);
    await expect(createFirstAdmin(db, INPUT, null)).resolves.toMatchObject({
      email: "lead@example.org",
    });
  });

  it("refuses an email that already belongs to a member, leaving them as they were", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('lead@example.org', 'member')");
    const before = await snapshotUsers();

    const refusal = createFirstAdmin(db, INPUT, null);
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

      const run = createFirstAdmin(db, INPUT, null);
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
