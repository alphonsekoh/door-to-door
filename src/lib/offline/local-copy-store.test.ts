import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_COPY_TTL_MS, type LocalCopy, type LocalThread } from "@/lib/offline/local-copy";
import {
  LOCAL_DATABASE_NAME,
  clearLocalCopy,
  loadLocalCopy,
  updateLocalCopy,
} from "@/lib/offline/local-copy-store";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { DATABASE_NAME, openQueue } from "@/lib/sync/idb-queue";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const ALICE = "0190a000-0000-7000-8000-00000000000a";

const copy = (name = "Alice"): LocalCopy => ({
  v: 3,
  member: { id: ALICE, name },
  savedAt: NOW,
  outing: null,
  blocks: [],
  revisits: null,
  threads: [],
});

const STAMP = "2026-10-15T09:00:00.000Z";

/* A listed unit's history, read at `savedAt`. */
const thread = (unit: string, savedAt: number): LocalThread => ({
  savedAt,
  history: {
    household: {
      id: `0190a000-0000-7000-8000-${unit.padStart(12, "0")}`,
      blockId: "0190a000-0000-7000-8000-000000000123",
      unitNumber: `#05-${unit}`,
      name: null,
      contact: null,
      religion: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: {
      id: "0190a000-0000-7000-8000-000000000123",
      name: "123",
      street: "Ang Mo Kio Ave 3",
      postalCode: null,
      createdAt: STAMP,
    },
    visits: [],
    answered: false,
    pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
    followUps: [],
  },
});

async function raw(): Promise<unknown> {
  const db = await openDB(LOCAL_DATABASE_NAME);
  const value: unknown = await db.get("copy", "current");
  db.close();
  return value;
}

async function writeRaw(value: unknown): Promise<void> {
  await updateLocalCopy(() => copy());
  const db = await openDB(LOCAL_DATABASE_NAME);
  await db.put("copy", value, "current");
  db.close();
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the local copy on disk", () => {
  it("is empty to begin with", async () => {
    expect(await loadLocalCopy()).toBeNull();
  });

  it("keeps what was written across connections", async () => {
    await updateLocalCopy(() => copy());
    expect(await loadLocalCopy(NOW)).toEqual(copy());
  });

  it("hands the change what is there, and writes what it returns", async () => {
    await updateLocalCopy(() => copy());
    const change = vi.fn((current: LocalCopy | null) =>
      current === null ? null : { ...current, savedAt: NOW + 1 },
    );
    await updateLocalCopy(change);
    expect(change).toHaveBeenCalledWith(copy());
    expect(await loadLocalCopy(NOW)).toEqual({ ...copy(), savedAt: NOW + 1 });
  });

  it("writes nothing when the change returns what it was given", async () => {
    await writeRaw({ ...copy(), extra: "kept because nothing was written" });
    await updateLocalCopy((current) => current);
    expect(await raw()).toMatchObject({ extra: "kept because nothing was written" });
  });

  it("deletes when the change returns null", async () => {
    await updateLocalCopy(() => copy());
    await updateLocalCopy(() => null);
    expect(await raw()).toBeUndefined();
  });

  it("keeps a copy for twelve hours from its last write", async () => {
    await updateLocalCopy(() => copy());
    expect(await loadLocalCopy(NOW + LOCAL_COPY_TTL_MS)).toEqual(copy());
    expect(await raw()).toEqual(copy());
  });

  it("reads a copy past its twelve hours as nothing, and deletes it", async () => {
    // Nothing can record with it again, and it still names households (#130).
    await updateLocalCopy(() => copy());
    expect(await loadLocalCopy(NOW + LOCAL_COPY_TTL_MS + 1)).toBeNull();
    expect(await raw()).toBeUndefined();
  });

  it("measures the copy's age against the clock unless told otherwise", async () => {
    await updateLocalCopy(() => ({ ...copy(), savedAt: Date.now() }));
    expect(await loadLocalCopy()).not.toBeNull();
    await updateLocalCopy(() => copy());
    expect(await loadLocalCopy()).toBeNull();
  });

  it("drops a thread past its own twelve hours, keeping the copy and the others", async () => {
    const old = thread("01", NOW - LOCAL_COPY_TTL_MS - 1);
    const recent = thread("02", NOW - 1000);
    await updateLocalCopy(() => ({ ...copy(), savedAt: NOW - 1000, threads: [old, recent] }));
    const loaded = await loadLocalCopy(NOW);
    expect(loaded?.threads).toEqual([recent]);
    expect(loaded?.savedAt).toBe(NOW - 1000);
    expect(((await raw()) as LocalCopy).threads).toEqual([recent]);
  });

  it("leaves a copy whose threads are all live as it was", async () => {
    const recent = thread("02", NOW - 1000);
    await updateLocalCopy(() => ({ ...copy(), threads: [recent] }));
    expect(await loadLocalCopy(NOW)).toEqual({ ...copy(), threads: [recent] });
  });

  it("reads an unreadable copy as nothing, and deletes it", async () => {
    await writeRaw({ v: 99, member: "someone" });
    expect(await loadLocalCopy()).toBeNull();
    expect(await raw()).toBeUndefined();
  });

  it("does nothing at all without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await loadLocalCopy()).toBeNull();
    await expect(updateLocalCopy(() => copy())).resolves.toBeUndefined();
    await expect(clearLocalCopy()).resolves.toBeUndefined();
  });
});

describe("clearLocalCopy", () => {
  it("forgets the copy", async () => {
    await updateLocalCopy(() => copy());
    await clearLocalCopy();
    // Read in date, so only the clear can have removed it.
    expect(await loadLocalCopy(NOW)).toBeNull();
    expect(await raw()).toBeUndefined();
  });

  /* Owner decision D-33-1: a previous member's queued records stay on the
     phone and send when they sign in again. Clearing the copy must not
     touch them, so this reads the queue's own database, past its API. */
  it("never touches the sync queue", async () => {
    const queue = await openQueue();
    const waiting = buildQueuedVisit(
      {
        blockId: "0190a000-0000-7000-8000-0000000000bb",
        unitNumber: "#05-01",
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: "0190a000-0000-7000-8000-0000000000cc",
      },
      ALICE,
      NOW,
    );
    await queue?.put(waiting);
    await updateLocalCopy(() => copy());

    await clearLocalCopy();

    const databases = await indexedDB.databases();
    expect(databases.map((d) => d.name)).toContain(DATABASE_NAME);
    const db = await openDB(DATABASE_NAME);
    expect(await db.getAll("visits")).toEqual([waiting]);
    db.close();
  });
});

describe("a newer build", () => {
  it("can upgrade the database between operations, nothing holding it open", async () => {
    await updateLocalCopy(() => copy());
    const upgraded = await openDB(LOCAL_DATABASE_NAME, 2);
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });
});
