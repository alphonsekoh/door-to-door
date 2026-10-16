/*
 * How long a save waits to learn which outing is running before it gives up.
 * Short on purpose: a save is the member at a door, and weak signal stalls a
 * request rather than failing it, so without a limit the button would sit on
 * "Saving…" until the browser gave up (D-33-10).
 */
export const OUTING_ASK_TIMEOUT_MS = 4_000;

/* Resolves to the outing's id, or null if the answer did not come in time.
   The request itself is left to finish: if it lands later, the page learns
   the outing and the next save uses it without asking. */
export function askOutingWithin(
  ask: () => Promise<string | null>,
  timeoutMs = OUTING_ASK_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  return Promise.race([ask(), gaveUp]).finally(() => {
    clearTimeout(timer);
  });
}
