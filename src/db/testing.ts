import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import type { Database } from "@/db/client";
import { attachPoolErrorHandler } from "@/db/pool-errors";
import { requireTestDatabaseUrl } from "@/db/test-env";

/*
 * A pool for integration tests. Small on purpose - these run serially against
 * a scratch database and do not need concurrency.
 */
export function createTestPool(): Pool {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
  attachPoolErrorHandler(pool);
  return pool;
}

/* Removes all seeded and test data, respecting foreign key order. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE erasure_requests, retention_runs, follow_ups, visit_teammates, visits, session_team_members, session_teams,
             session_participants, session_households, households, session_blocks,
             outing_sessions,
             accounts, auth_sessions, verification_tokens, sign_ins, blocks, users
    RESTART IDENTITY CASCADE
  `);
}

/* A sign-in id of its own for each user, fixed so a test can name it. */
export function testSignInId(userId: string): string {
  const hex = createHash("sha256").update(`sign-in:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type TestSession = {
  user: { id: string; role: "admin" | "member"; deactivated: boolean } & Record<string, unknown>;
  signInId: string;
};

/*
 * What a mocked auth() returns for a user with a live sign-in behind it
 * (#125): every request checks the token's sign-in, so a session without one
 * is signed out. Set as the mock's implementation, so the row is written when
 * the handler asks, after whatever the test truncated or seeded:
 *
 *   auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }))
 *
 * A user that does not exist gets no row, and an ended sign-in is written
 * again on the next call; a test about ending sign-ins resolves the mock once.
 */
export async function signedInAs(
  pool: Pool,
  user: { id: string; role?: "admin" | "member" } & Record<string, unknown>,
): Promise<TestSession> {
  const signInId = testSignInId(user.id);
  await pool.query(
    `INSERT INTO sign_ins (id, user_id) SELECT $1, id FROM users WHERE id = $2
     ON CONFLICT (id) DO NOTHING`,
    [signInId, user.id],
  );
  return { user: { role: "member", deactivated: false, ...user }, signInId };
}

/*
 * Where this run's test config lives. Set by the integration globalSetup, which
 * runs once per Vitest run before any worker starts, so every worker of one run
 * inherits the same folder and a second run on the same machine gets its own.
 */
export const TEST_CONFIG_DIR_ENV = "DOOR_TO_DOOR_TEST_CONFIG_DIR";

/* Creates a fresh folder for this run's config; the returned function removes it. */
export function createTestConfigDir(
  env: Record<string, string | undefined> = process.env,
): () => void {
  const dir = mkdtempSync(join(tmpdir(), "door-to-door-test-config-"));
  env[TEST_CONFIG_DIR_ENV] = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}

/*
 * Points the app's own config loader at the test database, the way a real
 * deployment would: a credential-free URL in a YAML file, credentials in the
 * environment. Without it, anything calling getDatabase() would find no file.
 */
export function applyTestConfig(env: Record<string, string | undefined> = process.env): void {
  const url = new URL(requireTestDatabaseUrl(env));
  const dir = env[TEST_CONFIG_DIR_ENV];
  if (!dir) {
    throw new Error(
      `${TEST_CONFIG_DIR_ENV} is not set: run integration tests through Vitest, whose globalSetup creates it.`,
    );
  }
  env["DATABASE_USER"] = decodeURIComponent(url.username);
  env["DATABASE_PASSWORD"] = decodeURIComponent(url.password);
  env["AUTH_SECRET"] ??= "integration-tests-only-secret-0123456789";

  url.username = "";
  url.password = "";
  const path = join(dir, "config.yaml");
  writeFileSync(
    path,
    `database:\n  url: ${JSON.stringify(url.toString())}\n` +
      "privacy:\n  organisation: Test Operator\n  dpoEmail: dpo@example.com\n",
  );
  env["CONFIG_PATH"] = path;
}

/*
 * A database that fails the test on any use at all, for proving a request is
 * refused before anything is read, locked or written.
 */
export function untouchableDatabase(): Database {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        throw new Error(`the database was used: ${String(key)}`);
      },
    },
  ) as Database;
}
