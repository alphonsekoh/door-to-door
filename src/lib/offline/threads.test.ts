import { describe, expect, it } from "vitest";
import {
  PRELOAD_AT_ONCE,
  THREAD_REFRESH_MS,
  newerThread,
  queuedInThread,
  staleThreads,
  threadAt,
} from "@/lib/offline/threads";
import {
  BLOCK_ID,
  entryFor,
  history,
  queuedRecord,
  thread,
  visit,
} from "../../../test/thread-fixtures";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

describe("threadAt", () => {
  it("finds a unit by block and normalised number", () => {
    const threads = [thread(1, NOW), thread(2, NOW)];
    expect(threadAt(threads, BLOCK_ID, " 05-02 ")).toBe(threads[1]);
    expect(threadAt(threads, BLOCK_ID, "#05-02")).toBe(threads[1]);
  });

  it("finds nothing in another block, or for an unknown unit", () => {
    const threads = [thread(1, NOW)];
    expect(threadAt(threads, "0190a000-0000-7000-8000-000000000999", "#05-01")).toBeUndefined();
    expect(threadAt(threads, BLOCK_ID, "#05-09")).toBeUndefined();
  });
});

describe("staleThreads", () => {
  const h1 = history(1);
  const h2 = history(2);
  const list = [entryFor(h1), entryFor(h2)];

  it("is empty when every thread is held and agrees with the list", () => {
    expect(staleThreads(list, [thread(1, NOW), thread(2, NOW)], NOW)).toEqual([]);
  });

  it("names a household with no thread yet, in list order", () => {
    expect(staleThreads(list, [], NOW)).toEqual([h1.household.id, h2.household.id]);
    expect(staleThreads(list, [thread(1, NOW)], NOW)).toEqual([h2.household.id]);
  });

  it("names one whose newest visit the list says is another", () => {
    const moved = { ...entryFor(h1), latestVisit: visit("0190a000-0000-7000-8000-0000000000f9") };
    expect(staleThreads([moved], [thread(1, NOW)], NOW)).toEqual([h1.household.id]);
  });

  it("names one whose newest visit was amended since", () => {
    const amended = visit(h1.visits[0]?.id ?? "", { updatedAt: "2026-10-15T09:30:00.000Z" });
    expect(
      staleThreads([{ ...entryFor(h1), latestVisit: amended }], [thread(1, NOW)], NOW),
    ).toEqual([h1.household.id]);
  });

  it("names one where the list has a visit the thread lacks, or the thread has one the list lacks", () => {
    const none = history(1, []);
    expect(staleThreads([entryFor(h1)], [thread(1, NOW, { visits: [] })], NOW)).toEqual([
      h1.household.id,
    ]);
    expect(staleThreads([entryFor(none)], [thread(1, NOW)], NOW)).toEqual([h1.household.id]);
    expect(staleThreads([entryFor(none)], [thread(1, NOW, { visits: [] })], NOW)).toEqual([]);
  });

  it("names one whose household changed", () => {
    const changed = { ...h1.household, updatedAt: "2026-10-15T09:45:00.000Z" };
    expect(staleThreads([{ ...entryFor(h1), household: changed }], [thread(1, NOW)], NOW)).toEqual([
      h1.household.id,
    ]);
  });

  it("names one read more than 15 minutes ago, and keeps one at exactly that", () => {
    const read = thread(1, NOW - THREAD_REFRESH_MS);
    expect(staleThreads([entryFor(h1)], [read], NOW)).toEqual([]);
    expect(staleThreads([entryFor(h1)], [read], NOW + 1)).toEqual([h1.household.id]);
  });

  it("reads three at once", () => {
    expect(PRELOAD_AT_ONCE).toBe(3);
  });
});

describe("newerThread", () => {
  it("is the one read later, the first on a tie", () => {
    const early = thread(1, NOW);
    const late = thread(1, NOW + 1);
    expect(newerThread(early, late)).toBe(late);
    expect(newerThread(late, early)).toBe(late);
    const tie = thread(1, NOW);
    expect(newerThread(early, tie)).toBe(early);
  });

  it("is whichever there is, or null", () => {
    const only = thread(1, NOW);
    expect(newerThread(only, undefined)).toBe(only);
    expect(newerThread(null, only)).toBe(only);
    expect(newerThread(null, undefined)).toBeNull();
  });
});

describe("queuedInThread", () => {
  const none = new Set<string>();

  it("keeps this unit's records not yet in the thread, newest first", () => {
    const a = queuedRecord("#05-01", { id: "a", enqueuedAt: 1 });
    const b = queuedRecord(" 05-01", { id: "b", enqueuedAt: 2 });
    const other = queuedRecord("#05-02", { id: "c", enqueuedAt: 3 });
    const elsewhere = queuedRecord("#05-01", { id: "d", enqueuedAt: 4 }, { blockId: "x" });
    expect(
      queuedInThread([a, b, other, elsewhere], BLOCK_ID, "#05-01", none, 0).map((r) => r.id),
    ).toEqual(["b", "a"]);
  });

  it("leaves out a record the thread already holds", () => {
    const a = queuedRecord("#05-01", { id: "a" });
    expect(queuedInThread([a], BLOCK_ID, "#05-01", new Set(["a"]), 0)).toEqual([]);
  });

  it("keeps a sent record only when it was sent after the thread was read", () => {
    const sent = queuedRecord("#05-01", { id: "a", state: "synced", syncedAt: 500 });
    expect(queuedInThread([sent], BLOCK_ID, "#05-01", none, 499)).toEqual([sent]);
    expect(queuedInThread([sent], BLOCK_ID, "#05-01", none, 500)).toEqual([]);
    const oldRecord = queuedRecord("#05-01", { id: "b", state: "synced", syncedAt: null });
    expect(queuedInThread([oldRecord], BLOCK_ID, "#05-01", none, 0)).toEqual([]);
  });
});
