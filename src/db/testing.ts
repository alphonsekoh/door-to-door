import { Pool } from "pg";
import { requireDatabaseUrl } from "@/db/env";

/*
 * A pool for integration tests. Small on purpose - these run serially against
 * a scratch database and do not need concurrency.
 */
export function createTestPool(): Pool {
  return new Pool({ connectionString: requireDatabaseUrl(), max: 2 });
}

/* Removes all seeded and test data, respecting foreign key order. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE follow_ups, visits, households, session_blocks, outing_sessions,
             accounts, auth_sessions, verification_tokens, blocks, users
    RESTART IDENTITY CASCADE
  `);
}
