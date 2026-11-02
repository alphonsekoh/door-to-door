/*
 * How long a save waits to learn which outing is running before it gives up.
 * Short on purpose: a save is the member at a door, and weak signal stalls a
 * request rather than failing it, so without a limit the button would sit on
 * "Saving…" until the browser gave up (D-33-10).
 */
export const OUTING_ASK_TIMEOUT_MS = 4_000;

/* What asking for the running outing learnt. "none" is the server saying no
   outing is running; "unknown" is no answer at all (offline, a failure, a
   stall), which the member can fix by trying again where there is signal. */
export type OutingAnswer = { kind: "running"; id: string } | { kind: "none" } | { kind: "unknown" };

/* The answer, or "unknown" if it did not come in time. The request itself is
   left to finish: if it lands later, the page learns the outing and the next
   save uses it without asking. */
export function askOutingWithin(
  ask: () => Promise<OutingAnswer>,
  timeoutMs = OUTING_ASK_TIMEOUT_MS,
): Promise<OutingAnswer> {
  return within(ask(), { kind: "unknown" }, timeoutMs);
}

/* Whatever `answer` settles to, or `fallback` once `timeoutMs` has passed.
   For anything a save asks the server first, by the same limit. */
export function within<T>(answer: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, timeoutMs);
  });
  return Promise.race([answer, gaveUp]).finally(() => {
    clearTimeout(timer);
  });
}
