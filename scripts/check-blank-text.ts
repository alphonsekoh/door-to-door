import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachPoolErrorHandler } from "../src/db/pool-errors";
import * as schema from "../src/db/schema";
import { loadDatabaseUrl } from "../src/server/config";
import { runBlankTextCheck } from "../src/server/integrity/blank-text";

/*
 * Lists every row a not-blank constraint would refuse (#119), and changes
 * nothing. Run it before migrating. The logic and its tests live in
 * src/server/integrity; this only wires it to the process.
 *
 * Exits 0 when clean, 1 when it found blank rows, 2 when it could not check.
 */
async function main(): Promise<0 | 1> {
  const pool = new Pool({ connectionString: loadDatabaseUrl(), max: 1 });
  attachPoolErrorHandler(pool);

  try {
    const { lines, exitCode } = await runBlankTextCheck(drizzle(pool, { schema }));
    for (const line of lines) console.log(line);
    return exitCode;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`Could not check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
