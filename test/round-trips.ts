import type { Pool } from "pg";

type Query = (...args: unknown[]) => Promise<unknown>;

/*
 * How many database round trips a call waited on one after another (#252).
 * A query counts one more than the deepest that had answered before it was
 * sent, so queries sent together count once, and one that waited for another
 * counts after it. Only what goes through this pool's query is seen, which
 * is every Drizzle read outside a transaction.
 */
export function trackRoundTrips(pool: Pool) {
  const send = pool.query.bind(pool) as Query;
  const target = pool as unknown as { query: Query };
  let answered = 0;
  let deepest = 0;
  let sent = 0;

  target.query = (...args) => {
    const depth = answered + 1;
    sent += 1;
    deepest = Math.max(deepest, depth);
    const settle = () => {
      answered = Math.max(answered, depth);
    };
    return send(...args).then(
      (result) => {
        settle();
        return result;
      },
      (error: unknown) => {
        settle();
        throw error;
      },
    );
  };

  return {
    reset() {
      answered = 0;
      deepest = 0;
      sent = 0;
    },
    /* Round trips on the longest chain since the last reset. */
    get depth() {
      return deepest;
    },
    get sent() {
      return sent;
    },
    restore() {
      Reflect.deleteProperty(target, "query");
    },
  };
}
