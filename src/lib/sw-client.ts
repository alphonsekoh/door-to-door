import { API_CACHE_NAME, SW_MESSAGES } from "@/lib/sw-cache-rules";

/*
 * Forgets cached API answers. Called on sign-in (and belongs on sign-out too)
 * so a second member on a shared phone never reads the first one's data. The
 * page deletes the cache itself as well as asking the worker, because a worker
 * that is asleep or not yet controlling the page would miss the message.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: SW_MESSAGES.clearCaches });
  }
  if ("caches" in globalThis) {
    await caches.delete(API_CACHE_NAME);
  }
}
