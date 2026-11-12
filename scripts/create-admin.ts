import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachPoolErrorHandler } from "../src/db/pool-errors";
import * as schema from "../src/db/schema";
import { loadAppConfig, loadDatabaseUrl } from "../src/server/config";
import { promptHidden } from "../src/server/prompt";
import { runCreateAdmin } from "../src/server/users/create-admin-cli";

/*
 * Creates the first admin of a fresh database (#105). The logic and its tests
 * live in src/server/users; this only wires it to the process.
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadDatabaseUrl(), max: 1 });
  attachPoolErrorHandler(pool);

  try {
    const admin = await runCreateAdmin(drizzle(pool, { schema }), {
      argv: process.argv.slice(2),
      env: process.env,
      readFile: (path) => readFileSync(path, "utf8"),
      prompt: process.stdin.isTTY
        ? (question) => promptHidden(question, process.stdin, process.stdout)
        : undefined,
      googleDomains: loadAppConfig().auth.google?.domains ?? null,
    });
    console.log(
      admin.googleOnly
        ? `Created admin ${admin.email}. Sign in with Google as ${admin.email}.`
        : `Created admin ${admin.email}. Sign in with that email and the password given.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
