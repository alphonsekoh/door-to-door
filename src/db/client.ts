import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { getConfig } from "@/server/config";

export type Database = NodePgDatabase<typeof schema>;

/*
 * One pool per process. Creating a Pool does not open a connection, so this is
 * safe at import time and testable without a running database.
 */
let cached: { pool: Pool; db: Database } | undefined;

export function createDatabase(connectionString: string): { pool: Pool; db: Database } {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}

export function getDatabase(): Database {
  cached ??= createDatabase(getConfig().databaseUrl);
  return cached.db;
}

export function getPool(): Pool {
  cached ??= createDatabase(getConfig().databaseUrl);
  return cached.pool;
}

/* Tests reset the cache so each can supply its own connection. */
export async function resetDatabase(): Promise<void> {
  const current = cached;
  cached = undefined;
  if (current) {
    await current.pool.end();
  }
}
