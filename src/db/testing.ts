import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { requireTestDatabaseUrl } from "@/db/test-env";

/*
 * A pool for integration tests. Small on purpose - these run serially against
 * a scratch database and do not need concurrency.
 */
export function createTestPool(): Pool {
  return new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
}

/* Removes all seeded and test data, respecting foreign key order. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE follow_ups, visits, households, session_blocks, outing_sessions,
             accounts, auth_sessions, verification_tokens, blocks, users
    RESTART IDENTITY CASCADE
  `);
}

/*
 * Points the app's own config loader at the test database, the way a real
 * deployment would: a credential-free URL in a YAML file, credentials in the
 * environment. Without it, anything calling getDatabase() would find no file.
 */
export function applyTestConfig(env: NodeJS.ProcessEnv = process.env): void {
  const url = new URL(requireTestDatabaseUrl(env));
  env["DATABASE_USER"] = decodeURIComponent(url.username);
  env["DATABASE_PASSWORD"] = decodeURIComponent(url.password);
  env["AUTH_SECRET"] ??= "integration-tests-only-secret-0123456789";

  url.username = "";
  url.password = "";
  const dir = join(tmpdir(), "door-to-door-test-config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.yaml");
  writeFileSync(path, `database:\n  url: ${JSON.stringify(url.toString())}\n`);
  env["CONFIG_PATH"] = path;
}
