import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachPoolErrorHandler } from "@/db/pool-errors";
import * as schema from "@/db/schema";
import { getConfig } from "@/server/config";

export type Database = NodePgDatabase<typeof schema>;

type Cached = { pool: Pool; db: Database };

/*
 * One pool per process. Creating a Pool does not open a connection, so this is
 * safe at import time and testable without a running database. Next bundles
 * instrumentation, the proxy and routes as separate module graphs, each with
 * its own copy of this file, so the cache is process-wide like the config
 * warning's flag - otherwise each graph would open (and listen on) its own pool.
 */
const CACHE = Symbol.for("door-to-door.database");
const processWide = globalThis as Record<symbol, Cached | undefined>;

export function createDatabase(connectionString: string): { pool: Pool; db: Database } {
  const pool = new Pool({ connectionString });
  attachPoolErrorHandler(pool);
  return { pool, db: drizzle(pool, { schema }) };
}

function current(): Cached {
  const existing = processWide[CACHE] ?? createDatabase(getConfig().databaseUrl);
  processWide[CACHE] = existing;
  return existing;
}

export function getDatabase(): Database {
  return current().db;
}

export function getPool(): Pool {
  return current().pool;
}

/* Tests reset the cache so each can supply its own connection. */
export async function resetDatabase(): Promise<void> {
  const previous = processWide[CACHE];
  processWide[CACHE] = undefined;
  if (previous) {
    await previous.pool.end();
  }
}
