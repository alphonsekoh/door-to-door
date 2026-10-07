import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadDatabaseUrl } from "../src/server/config";

/*
 * Applies pending migrations, then exits. Used directly and by the Docker
 * `migrate` service (#5). Drizzle records what it has applied, so re-running
 * is a no-op.
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadDatabaseUrl(), max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
