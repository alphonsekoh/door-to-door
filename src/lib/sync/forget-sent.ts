import { CLEAR_WITHIN_MS } from "@/lib/pwa/sw-client";
import { sharedQueue } from "@/lib/sync/idb-queue";
import type { SyncQueue } from "@/lib/sync/types";

/*
 * Drops every sent record from the phone, whoever saved it, on sign-in and on
 * sign-out. A sent record is on the server already, and still holds a name, a
 * contact and notes; kept for its 24 hours (D-33-9) it would outlive the
 * member who saved it on a shared phone. At sign-in the member before is not
 * known, so it is everyone's. Nothing unsent is touched (D-33-1, D-33-2).
 *
 * Bounded as the cache clear is, so storage that never answers cannot hold a
 * member on "Signing in…" or "Signing out…".
 */
export async function forgetSentRecords(
  within = CLEAR_WITHIN_MS,
  open: () => Promise<SyncQueue | null> = sharedQueue,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, within);
  });
  try {
    await Promise.race([forget(open), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function forget(open: () => Promise<SyncQueue | null>): Promise<void> {
  const queue = await open();
  await queue?.deleteSyncedBefore(Number.POSITIVE_INFINITY);
}
