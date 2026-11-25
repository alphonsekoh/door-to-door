import { isExpired, isSent, isUnsentBefore, readRecord } from "@/lib/sync/record";
import type { QueuedVisit, SyncQueue } from "@/lib/sync/types";

/*
 * The queue without IndexedDB, for the engine's tests. Records are cloned in
 * and out, as IndexedDB does, so a test cannot pass by mutating what it
 * handed over.
 */
export function createMemoryQueue(initial: readonly unknown[] = []): SyncQueue & {
  raw: Map<string, unknown>;
} {
  const raw = new Map<string, unknown>();
  for (const record of initial) raw.set(String(Reflect.get(record as object, "id")), record);

  const all = () => [...raw.values()].map((value) => readRecord(structuredClone(value)));

  const remove = (doomed: (record: QueuedVisit) => boolean) => {
    let removed = 0;
    for (const [id, value] of raw) {
      if (doomed(readRecord(value))) {
        raw.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  };

  return {
    raw,
    put(record) {
      raw.set(record.id, structuredClone(record));
      return Promise.resolve();
    },
    putMany(records) {
      for (const record of records) raw.set(record.id, structuredClone(record));
      return Promise.resolve();
    },
    get(id) {
      const value = raw.get(id);
      return Promise.resolve(value === undefined ? undefined : readRecord(structuredClone(value)));
    },
    listByOwner(ownerId) {
      return Promise.resolve(all().filter((record) => record.ownerId === ownerId));
    },
    listAll() {
      return Promise.resolve(all());
    },
    deleteSyncedBefore(before) {
      return remove((record) => isExpired(record, before));
    },
    deleteUnsentBefore(before) {
      return remove((record) => isUnsentBefore(record, before));
    },
    deleteSentBy(ownerId) {
      return remove((record) => record.ownerId === ownerId && isSent(record));
    },
  };
}
