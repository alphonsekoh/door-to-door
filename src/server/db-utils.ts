import { InternalError } from "@/server/http/errors";

/*
 * Takes the single row a query is guaranteed to produce - a count, an insert
 * with returning - and fails loudly if it did not.
 *
 * Written as a helper rather than `rows[0]?.x ?? fallback` so the impossible
 * case is stated once and tested once, instead of leaving an untestable
 * fallback at every call site whose value nobody could justify.
 */
export function firstOrThrow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new InternalError(`Expected ${what} to return a row.`);
  }
  return row;
}
