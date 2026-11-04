import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { type LocalCopy, copyExpired, readCopy } from "@/lib/offline/local-copy";

/*
 * The local copy on disk. A database of its own, never the queue's
 * `door-to-door`: clearing a member's copy must never touch anyone's queued
 * records (D-33-1), and keeping them apart makes that true by construction.
 * It also spares the queue a version bump, which an open tab of an older
 * build would block. The service worker opens neither (D-32-5).
 */

export const LOCAL_DATABASE_NAME = "door-to-door-local";
const VERSION = 1;
const STORE = "copy";
const KEY = "current";

type Schema = DBSchema & { copy: { key: string; value: unknown } };

async function withStore<T>(
  run: (db: IDBPDatabase<Schema>) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;
  /* Opened per operation and closed straight after, unlike the queue's
     shared connection, so a newer build's upgrade never waits on this. */
  const db = await openDB<Schema>(LOCAL_DATABASE_NAME, VERSION, {
    upgrade(database) {
      database.createObjectStore(STORE);
    },
  });
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

/*
 * What is saved, or null. Anything unreadable is deleted: it is a cache. So
 * is a copy past its 12 hours, which nothing can use again and which still
 * names households and their contacts.
 */
export function loadLocalCopy(now = Date.now()): Promise<LocalCopy | null> {
  return withStore(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const raw: unknown = await tx.store.get(KEY);
    const read = readCopy(raw);
    const copy = read === null || copyExpired(read, now) ? null : read;
    if (copy === null && raw !== undefined) await tx.store.delete(KEY);
    await tx.done;
    return copy;
  }, null);
}

/*
 * Read, change and write in one transaction, so two screens noting at once
 * cannot lose each other's block, and a check-then-clear cannot remove a copy
 * written in between. `change` returning what it was given writes nothing;
 * returning null deletes.
 */
export function updateLocalCopy(
  change: (current: LocalCopy | null) => LocalCopy | null,
): Promise<void> {
  return withStore(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const current = readCopy(await tx.store.get(KEY));
    const next = change(current);
    if (next === null) await tx.store.delete(KEY);
    else if (next !== current) await tx.store.put(next, KEY);
    await tx.done;
  }, undefined);
}

export function clearLocalCopy(): Promise<void> {
  return updateLocalCopy(() => null);
}
