import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { isExpired, isSent, readRecord } from "@/lib/sync/record";
import type { QueuedVisit, SyncQueue } from "@/lib/sync/types";

/*
 * The queue on disk. The service worker never opens this database (D-32-5):
 * it belongs to the page, and every deploy must leave it untouched.
 */

export const DATABASE_NAME = "door-to-door";
const VERSION = 1;
const STORE = "visits";

type Schema = DBSchema & {
  visits: { key: string; value: QueuedVisit; indexes: { "by-owner": string } };
};

function wrap(db: IDBPDatabase<Schema>): SyncQueue {
  /* Read back as unknown: what is on disk is whatever an earlier build wrote. */
  const read = (values: readonly unknown[]) => values.map(readRecord);

  return {
    async put(record) {
      await db.put(STORE, record);
    },
    async putMany(records) {
      const tx = db.transaction(STORE, "readwrite");
      await Promise.all([...records.map((record) => tx.store.put(record)), tx.done]);
    },
    async get(id) {
      const value: unknown = await db.get(STORE, id);
      return value === undefined ? undefined : readRecord(value);
    },
    async listByOwner(ownerId) {
      return read(await db.getAllFromIndex(STORE, "by-owner", ownerId));
    },
    async listAll() {
      return read(await db.getAll(STORE));
    },
    async deleteSyncedBefore(before) {
      const tx = db.transaction(STORE, "readwrite");
      let removed = 0;
      for await (const cursor of tx.store) {
        if (isExpired(readRecord(cursor.value), before)) {
          await cursor.delete();
          removed += 1;
        }
      }
      await tx.done;
      return removed;
    },
    async deleteSentBy(ownerId) {
      /* Through the owner index, so another member's rows are never touched.
         A range of exactly one key: a missing owner throws rather than
         reading as no range, which would walk every owner's. */
      const own = IDBKeyRange.only(ownerId);
      const tx = db.transaction(STORE, "readwrite");
      let removed = 0;
      for await (const cursor of tx.store.index("by-owner").iterate(own)) {
        if (isSent(readRecord(cursor.value))) {
          await cursor.delete();
          removed += 1;
        }
      }
      await tx.done;
      return removed;
    },
  };
}

/*
 * Null when there is no IndexedDB (an old browser, some private modes) or it
 * refuses to open. The caller then saves straight to the server instead.
 */
export async function openQueue(): Promise<SyncQueue | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDB<Schema>(DATABASE_NAME, VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by-owner", "ownerId");
      },
      /* A newer build in another tab wants to upgrade. Letting go is what lets
         it; this tab's next write fails and is reported, never lost. */
      blocking() {
        db.close();
      },
    });
    return wrap(db);
  } catch {
    return null;
  }
}

let shared: Promise<SyncQueue | null> | undefined;

/* One connection per page, shared by the sync engine and the checks that ask
   whether anything is still waiting. */
export function sharedQueue(): Promise<SyncQueue | null> {
  shared ??= openQueue();
  return shared;
}
