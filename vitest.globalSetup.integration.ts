import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnvFile, requireDatabaseUrl } from "./src/db/env";

/*
 * Brings the test database up to the current schema once per run. Fails loudly
 * when DATABASE_URL is absent rather than skipping: an integration suite that
 * quietly runs zero tests is worse than one that does not run.
 */
export async function setup(): Promise<void> {
  loadEnvFile();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
