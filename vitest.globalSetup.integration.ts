import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { requireTestDatabaseUrl } from "./src/db/test-env";
import { createTestConfigDir } from "./src/db/testing";

/*
 * Brings the test database up to the current schema once per run. Fails loudly
 * when TEST_DATABASE_URL is absent rather than skipping: an integration suite
 * that quietly runs zero tests is worse than one that does not run.
 *
 * Also gives the run a private config folder (#109). Vitest calls the returned
 * teardown whether tests passed or failed, but not on Ctrl-C: it exits on the
 * first signal, and npm forwarding a second one kills it outright. So the
 * folder also goes on the first signal. Removal is idempotent.
 */
export async function setup(): Promise<() => void> {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
  const removeConfigDir = createTestConfigDir();
  for (const event of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.once(event, removeConfigDir);
  }
  return removeConfigDir;
}
