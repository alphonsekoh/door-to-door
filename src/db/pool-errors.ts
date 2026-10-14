import type { Pool, PoolClient } from "pg";
import { createThrottledLog, summarizeError } from "@/server/logging/error-log";

/*
 * pg emits `error` on a pool when an idle client dies (restart, failover,
 * pg_terminate_backend), and on a checked-out client between queries. An
 * EventEmitter with no listener turns either into an uncaught exception. With
 * a listener the pool discards the dead client and reconnects on the next
 * query; a query awaiting that connection rejects, which handlers already
 * turn into a 500 (never an allow).
 */
export function attachPoolErrorHandler(
  pool: Pool,
  log?: (line: string) => void,
  now?: () => number,
): void {
  const throttled = createThrottledLog({
    ...(log ? { log } : {}),
    ...(now ? { now } : {}),
  });
  /*
   * One dead backend arrives up to three times: on the client, re-emitted on
   * the pool, then a second "terminated unexpectedly" when the socket ends. A
   * client that has failed once is finished, so later errors from it are the
   * same event.
   */
  const seen = new WeakSet<object>();

  const report = (error: unknown, client: PoolClient): void => {
    if (seen.has(client)) return;
    seen.add(client);
    throttled(
      "pool",
      `database connection error, the pool will reconnect: ${summarizeError(error)}`,
    );
  };

  pool.on("error", report);
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      report(error, client);
    });
  });
}
