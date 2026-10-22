import { API_CACHE_NAME, SW_MESSAGES } from "@/lib/pwa/sw-cache-rules";

/* The longest sign-in or sign-out waits for the cache to be cleared. */
export const CLEAR_WITHIN_MS = 1500;

/*
 * Forgets cached API answers. Called on sign-in and on sign-out so a second
 * member on a shared phone never reads the first one's data. The page deletes
 * the cache itself, and waits for that, so it is gone before the next screen
 * loads; the worker is told as well.
 *
 * Bounded as a whole, the browser's own calls included: a clear that never
 * settles must not hold a member on "Signing in…" any more than a failed one
 * may (D-32-21).
 */
export async function clearServiceWorkerCaches(within = CLEAR_WITHIN_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, within);
  });
  try {
    await Promise.race([clear(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function clear(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: SW_MESSAGES.clearCaches });
  }
  if ("caches" in globalThis) {
    await caches.delete(API_CACHE_NAME);
  }
}
