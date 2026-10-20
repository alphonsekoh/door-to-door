/* Long enough to stay out of the first load's way, short enough that a page
   opened with signal still has it. */
const IDLE_TIMEOUT_MS = 2000;
const NO_IDLE_DELAY_MS = 200;

/*
 * Runs `task` once the page has nothing more pressing to do, and returns a
 * way to call it off. Safari has no requestIdleCallback; there it runs a
 * moment later instead.
 */
export function whenIdle(task: () => void): () => void {
  if ("requestIdleCallback" in globalThis) {
    const id = requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => {
      cancelIdleCallback(id);
    };
  }
  const id = setTimeout(task, NO_IDLE_DELAY_MS);
  return () => {
    clearTimeout(id);
  };
}
