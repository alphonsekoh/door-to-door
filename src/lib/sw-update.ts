import { SW_MESSAGES } from "@/lib/sw-cache-rules";

/*
 * Finding out that a newer worker is waiting, and letting the member choose
 * when to switch. Nothing here ever reloads by itself.
 */

/* Calls back for a worker that is installed and waiting behind the one in
   charge. The very first install has no controller yet and is not an update. */
export function watchForWaitingWorker(
  registration: ServiceWorkerRegistration,
  hasController: () => boolean,
  onWaiting: (worker: ServiceWorker) => void,
): () => void {
  if (registration.waiting && hasController()) onWaiting(registration.waiting);

  const onUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && hasController()) onWaiting(installing);
    });
  };
  registration.addEventListener("updatefound", onUpdateFound);
  return () => {
    registration.removeEventListener("updatefound", onUpdateFound);
  };
}

/* Asks the waiting worker to take over; the page reloads when it does. */
export function activateWaitingWorker(worker: ServiceWorker, onActivated: () => void): void {
  navigator.serviceWorker.addEventListener("controllerchange", onActivated, { once: true });
  worker.postMessage({ type: SW_MESSAGES.skipWaiting });
}

/* Placeholder until the offline queue exists (#33), which will answer whether
   any saved visit has yet to reach the server. Updating must wait for it:
   a reload mid-sync is how a queue gets abandoned. */
export function hasUnsyncedItems(): Promise<boolean> {
  return Promise.resolve(false);
}
