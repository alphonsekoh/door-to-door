import { loadLocalCopy } from "@/lib/offline/local-copy-store";
import { RETENTION_PERIODS } from "@/lib/privacy/policy";
import { CLEAR_WITHIN_MS } from "@/lib/pwa/sw-client";
import { SYNCED_KEPT_MS } from "@/lib/sync/controller";
import { sharedQueue } from "@/lib/sync/idb-queue";
import type { SyncQueue } from "@/lib/sync/types";

/*
 * What this phone deletes when the app starts, whoever is signed in and
 * whether anyone is (#279): the privacy policy's promise that a copy of a
 * household's data does not outlive its period here. Before this, an expired
 * copy went only when the offline shell read it, and a sent record only when
 * a member signed in.
 *
 * - sent records, and the stubs of erased ones, after their 24 hours, for
 *   every member's, as the controller deletes the signed-in member's (D-33-9);
 * - a record still unsent 30 days after it was saved, held, stopped and
 *   unreadable ones included (D-279, refining D-33-2, D-33-8 and D-34-8);
 * - the units copy once its 12 hours are up, by reading it: a read deletes an
 *   expired or unreadable one.
 *
 * Bounded as forgetSentRecords is: storage that never answers must not hold
 * anything up. A failure is nothing to report: the next start tries again.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const UNSENT_KEPT_MS = RETENTION_PERIODS.unsentRecordDays * DAY_MS;

export async function purgeOnStart(
  now: () => number = Date.now,
  within = CLEAR_WITHIN_MS,
  open: () => Promise<SyncQueue | null> = sharedQueue,
  readCopy: (now: number) => Promise<unknown> = loadLocalCopy,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, within);
  });
  try {
    await Promise.race([purge(now(), open, readCopy), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function purge(
  now: number,
  open: () => Promise<SyncQueue | null>,
  readCopy: (now: number) => Promise<unknown>,
): Promise<void> {
  await Promise.all([
    open().then(async (queue) => {
      await queue?.deleteSyncedBefore(now - SYNCED_KEPT_MS);
      await queue?.deleteUnsentBefore(now - UNSENT_KEPT_MS);
    }),
    readCopy(now),
  ]).catch(() => undefined);
}
