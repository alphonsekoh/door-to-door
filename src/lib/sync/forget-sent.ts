import { CLEAR_WITHIN_MS } from "@/lib/pwa/sw-client";
import { sharedQueue } from "@/lib/sync/idb-queue";
import type { SyncQueue } from "@/lib/sync/types";

/*
 * Drops the sent records of the member signing out. A sent record is on the
 * server already, and still holds a name, a contact and notes; kept for its
 * 24 hours (D-33-9) it would outlive that member's sign-out on a shared phone.
 * Another member's sent records keep their 24 hours, and nothing unsent is
 * touched, whoever saved it (D-33-1, D-33-2).
 *
 * Undefined is a screen that does not know who is signing out, and then
 * nothing goes: no record there can be told to be theirs.
 *
 * Bounded as the cache clear is, so storage that never answers cannot hold a
 * member on "Signing out…".
 */
export async function forgetSentRecords(
  ownerId: string | undefined,
  within = CLEAR_WITHIN_MS,
  open: () => Promise<SyncQueue | null> = sharedQueue,
): Promise<void> {
  if (ownerId === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, within);
  });
  try {
    await Promise.race([forget(ownerId, open), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function forget(ownerId: string, open: () => Promise<SyncQueue | null>): Promise<void> {
  const queue = await open();
  await queue?.deleteSentBy(ownerId);
}
