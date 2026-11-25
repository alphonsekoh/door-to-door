import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import { UNSENT_KEPT_MS, purgeOnStart } from "@/lib/sync/purge-on-start";
import { SYNCED_KEPT_MS } from "@/lib/sync/controller";
import type { QueuedVisit, RecordState } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const HOUR = 3_600_000;

function record(ownerId: string, unit: string, state: RecordState, ago: number): QueuedVisit {
  const built = buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber: unit,
      interestLevel: "high",
      description: "Asked us back",
      name: "Mr Tan",
      contact: "91234567",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    NOW - ago,
  );
  return state === "synced" ? { ...built, state, syncedAt: NOW - ago } : { ...built, state };
}

const units = (records: readonly QueuedVisit[]) => records.map((r) => r.item.unitNumber).sort();
const ready = (queue: ReturnType<typeof createMemoryQueue> | null) => () => Promise.resolve(queue);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("purgeOnStart (#279)", () => {
  it("deletes sent and erased records past their 24 hours, whoever's, and keeps the rest", async () => {
    const queue = createMemoryQueue([
      record("ann", "#01-01", "synced", SYNCED_KEPT_MS + HOUR),
      record("ben", "#01-02", "synced", SYNCED_KEPT_MS + HOUR),
      record("ann", "#01-03", "synced", HOUR),
    ]);
    await purgeOnStart(
      () => NOW,
      1500,
      ready(queue),
      () => Promise.resolve(null),
    );
    expect(units(await queue.listAll())).toEqual(["#01-03"]);
  });

  it("deletes a record still unsent after 30 days, in any state, and keeps a younger one", async () => {
    const states: RecordState[] = ["queued", "failed", "held", "quarantined"];
    const old = states.map((state, i) =>
      record("ann", `#02-0${String(i)}`, state, UNSENT_KEPT_MS + HOUR),
    );
    const young = record("ben", "#03-01", "held", UNSENT_KEPT_MS - HOUR);
    const queue = createMemoryQueue([...old, young]);

    await purgeOnStart(
      () => NOW,
      1500,
      ready(queue),
      () => Promise.resolve(null),
    );

    expect(units(await queue.listAll())).toEqual(["#03-01"]);
  });

  it("reads the units copy, which deletes it once expired or unreadable", async () => {
    const readCopy = vi.fn(() => Promise.resolve(null));
    await purgeOnStart(() => NOW, 1500, ready(createMemoryQueue()), readCopy);
    expect(readCopy).toHaveBeenCalledWith(NOW);
  });

  it("still reads the copy where there is no IndexedDB for the queue", async () => {
    const readCopy = vi.fn(() => Promise.resolve(null));
    await purgeOnStart(() => NOW, 1500, ready(null), readCopy);
    expect(readCopy).toHaveBeenCalledOnce();
  });

  it("reports nothing when storage fails: the next start tries again", async () => {
    const queue = createMemoryQueue();
    queue.deleteSyncedBefore = () => Promise.reject(new Error("quota"));
    await expect(
      purgeOnStart(
        () => NOW,
        1500,
        ready(queue),
        () => Promise.resolve(null),
      ),
    ).resolves.toBeUndefined();
  });

  it("gives up after its time, so storage that never answers holds nothing up", async () => {
    const never = () => new Promise<never>(() => undefined);
    const done = purgeOnStart(() => NOW, 1500, never, never);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(done).resolves.toBeUndefined();
  });

  it("is asked of the real queue and copy by default, and survives none being there", async () => {
    await expect(purgeOnStart()).resolves.toBeUndefined();
  });
});
