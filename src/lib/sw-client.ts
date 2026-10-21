import { API_CACHE_NAME, SW_MESSAGES } from "@/lib/sw-cache-rules";

/* How long sign-in or sign-out waits for the worker to say it has cleared.
   A worker from a build before it answered never does, but still clears. */
export const CLEAR_ANSWER_MS = 1500;

/*
 * Forgets cached API answers. Called on sign-in and on sign-out so a second
 * member on a shared phone never reads the first one's data.
 *
 * One side deletes the cache, never both at once. With a worker active it is
 * asked, and woken to answer if asleep; the page waits for the answer, for a
 * while at most, and leaves the cache alone. On WebKit the page deleting it
 * at the same time as the worker, or while a first worker was installing,
 * could leave a promise that never settled, and sign-in then never left its
 * page. A worker never yet active has cached nothing, so while one installs
 * there is nothing to delete. With no worker at all, the page deletes it.
 */
export async function clearServiceWorkerCaches(answerWithin = CLEAR_ANSWER_MS): Promise<void> {
  const registration =
    "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration?.active) {
    await askToClear(registration.active, answerWithin);
    return;
  }
  if (registration !== undefined && (registration.installing ?? registration.waiting) !== null) {
    return;
  }
  if ("caches" in globalThis) {
    await caches.delete(API_CACHE_NAME);
  }
}

function askToClear(worker: ServiceWorker, within: number): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const answered = () => {
      clearTimeout(timer);
      channel.port1.close();
      resolve();
    };
    const timer = setTimeout(answered, within);
    channel.port1.onmessage = answered;
    worker.postMessage({ type: SW_MESSAGES.clearCaches }, [channel.port2]);
  });
}
