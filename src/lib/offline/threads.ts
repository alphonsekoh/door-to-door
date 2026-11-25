import type { RevisitEntry, Visit } from "@/generated/types.gen";
import type { LocalThread } from "@/lib/offline/local-copy";
import type { QueuedVisit } from "@/lib/sync/types";
import { normaliseUnitNumber } from "@/lib/units/unit-number";

/* A thread this old is read again at the next list read even when the list
   shows nothing moved: an amend of a household's name or contact moves
   neither its newest visit nor, always, its updated time. */
export const THREAD_REFRESH_MS = 15 * 60 * 1000;

/* Reads in flight at once while the phone fills its threads. */
export const PRELOAD_AT_ONCE = 3;

/* By block and normalised unit, so it needs no loaded block to find it. */
export function threadAt(
  threads: readonly LocalThread[],
  blockId: string,
  unitNumber: string,
): LocalThread | undefined {
  const unit = normaliseUnitNumber(unitNumber);
  return threads.find(
    ({ history }) => history.household.blockId === blockId && history.household.unitNumber === unit,
  );
}

function sameVisit(a: Visit | undefined, b: Visit | null): boolean {
  if (a === undefined || b === null) return a === undefined && b === null;
  return a.id === b.id && a.updatedAt === b.updatedAt;
}

/*
 * The listed households whose thread needs reading, in list order: none yet,
 * a newest visit or household the list says has moved, or one read long ago.
 */
export function staleThreads(
  revisits: readonly RevisitEntry[],
  threads: readonly LocalThread[],
  now: number,
): string[] {
  const byHousehold = new Map(threads.map((thread) => [thread.history.household.id, thread]));
  return revisits
    .filter((entry) => {
      const thread = byHousehold.get(entry.household.id);
      if (thread === undefined) return true;
      return (
        !sameVisit(thread.history.visits[0], entry.latestVisit) ||
        thread.history.household.updatedAt !== entry.household.updatedAt ||
        now - thread.savedAt > THREAD_REFRESH_MS
      );
    })
    .map((entry) => entry.household.id);
}

/* The one read later, the first when they tie. Null when there is neither. */
export function newerThread(a: LocalThread | null, b: LocalThread | undefined): LocalThread | null {
  if (a === null) return b ?? null;
  return b !== undefined && b.savedAt > a.savedAt ? b : a;
}

/*
 * This phone's records for a unit that the thread shown does not hold yet:
 * not sent, or sent after the thread was read. Newest first.
 */
export function queuedInThread(
  records: readonly QueuedVisit[],
  blockId: string,
  unitNumber: string,
  inThread: ReadonlySet<string>,
  since: number,
): QueuedVisit[] {
  const unit = normaliseUnitNumber(unitNumber);
  return records
    .filter(
      (record) =>
        record.item.blockId === blockId &&
        normaliseUnitNumber(record.item.unitNumber) === unit &&
        !inThread.has(record.id) &&
        (record.state !== "synced" || (record.syncedAt ?? 0) > since),
    )
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt);
}
