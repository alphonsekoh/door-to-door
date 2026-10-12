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

/* Narrows a nullable column the surrounding logic guarantees is set. */
export function presentOrThrow<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new InternalError(`Expected ${what} to be set.`);
  }
  return value;
}

/*
 * True when a database error was caused by violating a named constraint.
 *
 * Drizzle wraps the driver error, so the constraint name is never on the
 * top-level error - it sits on a cause further down. Getting this wrong means
 * a constraint violation escapes as a raw "Failed query" that no client can
 * act on.
 */
export function isConstraintViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { constraint?: string }).constraint === constraint) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/* Looks up a key a foreign key guarantees is there; fails loudly if it is not. */
export function getOrThrow<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new InternalError(`Expected ${what} to exist.`);
  }
  return value;
}
