import type { Pool, PoolClient } from "pg";

/*
 * pg emits `error` on a pool when an idle client dies (restart, failover,
 * pg_terminate_backend), and on a checked-out client between queries. An
 * EventEmitter with no listener turns either into an uncaught exception. With
 * a listener the pool discards the dead client and reconnects on the next
 * query; a query awaiting that connection rejects, which handlers already
 * turn into a 500 (never an allow).
 */
const QUIET_MS = 5_000;

/* Drivers sometimes echo the target; make sure a URL cannot reach the log. */
function describe(error: unknown): string {
  const raw = error instanceof Error ? error.message : "unknown error";
  const code = (error as { code?: unknown } | null)?.code;
  const message = raw.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]");
  return typeof code === "string" ? `${code}: ${message}` : message;
}

export function attachPoolErrorHandler(
  pool: Pool,
  log: (message: string) => void = (message) => {
    console.error(message);
  },
  now: () => number = Date.now,
): void {
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  let suppressed = 0;

  /* A restart kills every idle client at once; one line per burst, not one each. */
  const report = (error: unknown): void => {
    if (now() - lastLoggedAt < QUIET_MS) {
      suppressed += 1;
      return;
    }
    const extra = suppressed > 0 ? ` (${String(suppressed)} similar suppressed)` : "";
    suppressed = 0;
    lastLoggedAt = now();
    log(`database connection error, the pool will reconnect: ${describe(error)}${extra}`);
  };

  pool.on("error", report);
  pool.on("connect", (client: PoolClient) => client.on("error", report));
}
