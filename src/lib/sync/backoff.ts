/*
 * Retry timing (D-33-4). Full jitter: a whole team's phones regaining signal
 * on the same landing must not all retry on the same second.
 */

/* The tenth failure quarantines, after nine waits: at most 1215 s (about
   twenty minutes) from the first try, and about half that on average. */
export const MAX_ATTEMPTS = 10;
const BASE_MS = 5_000;
const CAP_MS = 300_000;

/* The 5-minute gap for anything the server refuses on a schedule of its own:
   the rate limiter counts clock-skew refusals (D-76-7), and a deactivated
   account or an ended outing changes only when an admin acts. */
export const PROBE_MS = 300_000;

/* After a 429. Kept even on a manual retry, or the tap would only earn another. */
export const RATE_LIMIT_MS = 60_000;

/* `attempts` is the count including the one that just failed, from 1. */
export function retryDelay(attempts: number, random: () => number): number {
  return Math.floor(random() * Math.min(CAP_MS, BASE_MS * 2 ** (attempts - 1)));
}

/* After a run the phone's own storage failed (a closed connection, a full
   disk). Doubling, no jitter: the wait is for this phone's disk, not for a
   server a whole team is hitting at once. */
export function storageRetryDelay(failures: number): number {
  return Math.min(CAP_MS, BASE_MS * 2 ** (failures - 1));
}
