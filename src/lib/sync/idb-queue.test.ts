import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { DATABASE_NAME, openQueue, sharedQueue } from "@/lib/sync/idb-queue";
import type { QueuedVisit, SyncQueue } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

const record = (ownerId: string, unitNumber: string, at = NOW): QueuedVisit =>
  buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber,
      interestLevel: "medium",
      description: "",
      name: "",
      contact: "",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    at,
  );

async function open(): Promise<SyncQueue> {
  const queue = await openQueue();
  if (queue === null) throw new Error("fake-indexeddb did not open");
  return queue;
}

/* What is actually on disk, read past the queue's own checks. */
async function rawRows(): Promise<unknown[]> {
  const db = await openDB(DATABASE_NAME);
  const rows: unknown[] = await db.getAll("visits");
  db.close();
  return rows;
}

beforeEach(() => {
  // A fresh, empty IndexedDB for every test.
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openQueue", () => {
  it("keeps a saved record across a reload of the page", async () => {
    const saved = record("ann", "#05-01");
    await (await open()).put(saved);

    // A second connection stands in for the next page load.
    const later = await open();
    expect(await later.listByOwner("ann")).toEqual([saved]);
    expect(await later.get(saved.id)).toEqual(saved);
    expect(await later.get("missing")).toBeUndefined();
  });

  it("lists only the owner's records through the index, and everyone's in full", async () => {
    const queue = await open();
    const ann = record("ann", "#05-01");
    const ben = record("ben", "#05-02");
    await queue.putMany([ann, ben]);
    expect(await queue.listByOwner("ann")).toEqual([ann]);
    expect(await queue.listByOwner("cat")).toEqual([]);
    expect((await queue.listAll()).map((r) => r.ownerId).sort()).toEqual(["ann", "ben"]);
  });

  it("returns a damaged record as stopped, without throwing or deleting it", async () => {
    const queue = await open();
    const damaged = { ...record("ann", "#05-01"), state: "synced", attempts: -1 } as QueuedVisit;
    await queue.put(damaged);

    const [read] = await queue.listByOwner("ann");
    expect(read).toMatchObject({
      id: damaged.id,
      state: "quarantined",
      lastError: { code: "corrupt" },
    });
    expect((await queue.get(damaged.id))?.state).toBe("quarantined");

    // Even claiming to be sent long ago, it is not purged.
    expect(await queue.deleteSyncedBefore(NOW * 2)).toBe(0);
    expect(await rawRows()).toEqual([damaged]);
  });

  it("purges only records sent before the cut-off", async () => {
    const queue = await open();
    const old = { ...record("ann", "#05-01"), state: "synced" as const, syncedAt: NOW - 10 };
    const recent = { ...record("ann", "#05-02"), state: "synced" as const, syncedAt: NOW };
    const unsent = record("ann", "#05-03");
    await queue.putMany([old, recent, unsent]);

    expect(await queue.deleteSyncedBefore(NOW - 1)).toBe(1);
    expect((await queue.listAll()).map((r) => r.id).sort()).toEqual([recent.id, unsent.id].sort());
  });

  it("is null where there is no IndexedDB at all", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await openQueue()).toBeNull();
  });

  it("is null when IndexedDB refuses to open", async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.stubGlobal("indexedDB", factory);
    expect(await openQueue()).toBeNull();
  });

  it("lets a newer version in another tab upgrade, rather than blocking it", async () => {
    const queue = await open();
    const upgraded = await openDB(DATABASE_NAME, 2);
    expect(upgraded.version).toBe(2);
    upgraded.close();
    // This tab let go, so its next write fails loudly rather than vanishing.
    await expect(queue.put(record("ann", "#05-01"))).rejects.toThrow();
  });
});

describe("sharedQueue", () => {
  it("opens one connection for the whole page", () => {
    expect(sharedQueue()).toBe(sharedQueue());
  });
});
