import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEAR_WITHIN_MS } from "@/lib/pwa/sw-client";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { forgetSentRecords } from "@/lib/sync/forget-sent";
import { sharedQueue } from "@/lib/sync/idb-queue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { QueuedVisit, RecordState } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const ANN = "0190a000-0000-7000-8000-00000000000a";
const BEN = "0190a000-0000-7000-8000-00000000000b";

function record(ownerId: string, unitNumber: string, state: RecordState = "queued"): QueuedVisit {
  const built = buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber,
      interestLevel: "high",
      description: "Asked us back on Sunday",
      name: "Mr Tan",
      contact: "91234567",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    NOW,
  );
  /* Sent a moment ago: well inside the 24 h the app-start purge keeps it. */
  return state === "synced" ? { ...built, state, syncedAt: NOW } : { ...built, state };
}

const units = (records: readonly QueuedVisit[]) => records.map((r) => r.item.unitNumber).sort();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("forgetSentRecords", () => {
  it("drops every sent record, whoever saved it, however recently", async () => {
    const queue = createMemoryQueue([
      record(ANN, "#01-01", "synced"),
      record(BEN, "#01-02", "synced"),
    ]);

    await forgetSentRecords(CLEAR_WITHIN_MS, () => Promise.resolve(queue));

    expect(await queue.listAll()).toEqual([]);
  });

  it("keeps everything not yet on the server, stopped and unreadable records too", async () => {
    // D-33-1 and D-33-2: nothing unsent leaves the phone but by being sent.
    const queue = createMemoryQueue([
      record(ANN, "#01-01", "synced"),
      record(ANN, "#02-01", "queued"),
      record(BEN, "#02-02", "failed"),
      record(BEN, "#02-03", "held"),
      record(ANN, "#02-04", "quarantined"),
      { id: "torn", ownerId: ANN, state: "synced" },
    ]);

    await forgetSentRecords(CLEAR_WITHIN_MS, () => Promise.resolve(queue));

    const left = await queue.listAll();
    expect(units(left)).toEqual(["", "#02-01", "#02-02", "#02-03", "#02-04"]);
    expect(left.find((r) => r.id === "torn")?.lastError).toEqual({ code: "corrupt" });
  });

  it("works on the queue on disk by default", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const queue = await sharedQueue();
    if (queue === null) throw new Error("IndexedDB did not open");
    await queue.putMany([record(ANN, "#01-01", "synced"), record(BEN, "#02-01")]);

    await forgetSentRecords();

    expect(units(await queue.listAll())).toEqual(["#02-01"]);
  });

  it("does nothing without a queue", async () => {
    await expect(
      forgetSentRecords(CLEAR_WITHIN_MS, () => Promise.resolve(null)),
    ).resolves.toBeUndefined();
  });

  it("gives up at the deadline when storage never answers", async () => {
    vi.useFakeTimers();
    let settled = false;
    void forgetSentRecords(CLEAR_WITHIN_MS, () => new Promise<never>(() => undefined)).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(CLEAR_WITHIN_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
