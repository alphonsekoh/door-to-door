import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
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
    TRUNCATE follow_ups, visit_teammates, visits, session_team_members, session_teams,
             session_participants, households, session_blocks, outing_sessions,
             accounts, auth_sessions, verification_tokens, blocks, users
    RESTART IDENTITY CASCADE
  `);
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
  writeFileSync(path, `database:\n  url: ${JSON.stringify(url.toString())}\n`);
  env["CONFIG_PATH"] = path;
}
