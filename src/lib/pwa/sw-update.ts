import { SW_MESSAGES } from "@/lib/pwa/sw-cache-rules";
import { sharedQueue } from "@/lib/sync/idb-queue";
import { isSending } from "@/lib/sync/sync-ui";
import type { QueuedVisit, SyncQueue } from "@/lib/sync/types";

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

/*
 * Two questions about the queue, kept apart because they have different
 * answers on purpose. Both say false when IndexedDB cannot be read: a broken
 * store must not trap anyone behind a prompt.
 */

async function ownRecords(
  ownerId: string | undefined,
  open: () => Promise<SyncQueue | null>,
): Promise<QueuedVisit[]> {
  try {
    const queue = await open();
    if (queue === null) return [];
    return ownerId === undefined ? await queue.listAll() : await queue.listByOwner(ownerId);
  } catch {
    return [];
  }
}

/*
 * Anything of this member's not yet on the server, held and stopped records
 * included: what the sign-out warning and the account message tell them
 * about (D-74-9, D-85-9). With no member known, anyone's.
 */
export async function hasUnsyncedItems(
  ownerId?: string,
  open: () => Promise<SyncQueue | null> = sharedQueue,
): Promise<boolean> {
  return (await ownRecords(ownerId, open)).some((record) => record.state !== "synced");
}

/*
 * Whether an update should wait (D-32-6, refined by D-33): only while this
 * member's records are still being sent. Held and stopped records, and other
 * members', survive the reload in IndexedDB and would otherwise hold every
 * update back indefinitely. A record in flight is still queued or failed on
 * disk, so it counts.
 */
export async function hasRecordsToSend(
  ownerId: string | undefined,
  open: () => Promise<SyncQueue | null> = sharedQueue,
): Promise<boolean> {
  if (ownerId === undefined) return false;
  return (await ownRecords(ownerId, open)).some(isSending);
}
