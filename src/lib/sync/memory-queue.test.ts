import { describe, expect, it } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

const record = (ownerId: string, unitNumber: string) =>
  buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber,
      interestLevel: "low",
      description: "",
      name: "",
      contact: "",
      religion: "",
      sessionId: "0190a000-0000-7000-8000-0000000000cc",
    },
    ownerId,
    NOW,
  );

describe("createMemoryQueue", () => {
  it("keeps what it is given apart from the caller's copy", async () => {
    const queue = createMemoryQueue();
    const saved = record("ann", "#01-01");
    await queue.put(saved);
    saved.state = "synced";
    expect((await queue.get(saved.id))?.state).toBe("queued");
    expect(await queue.get("missing")).toBeUndefined();
  });

  it("lists by owner and in full", async () => {
    const ann = record("ann", "#01-01");
    const ben = record("ben", "#01-02");
    const queue = createMemoryQueue([ann]);
    await queue.putMany([ben]);
    expect((await queue.listByOwner("ann")).map((r) => r.id)).toEqual([ann.id]);
    expect(await queue.listAll()).toHaveLength(2);
  });

  it("deletes only records sent before the cut-off", async () => {
    const old = { ...record("ann", "#01-01"), state: "synced" as const, syncedAt: NOW - 10 };
    const fresh = { ...record("ann", "#01-02"), state: "synced" as const, syncedAt: NOW };
    const unsent = record("ann", "#01-03");
    const queue = createMemoryQueue([old, fresh, unsent]);
    expect(await queue.deleteSyncedBefore(NOW - 1)).toBe(1);
    expect((await queue.listAll()).map((r) => r.id).sort()).toEqual([fresh.id, unsent.id].sort());
  });

  it("deletes one member's sent records, however recent, and nothing else", async () => {
    const sent = (ownerId: string, unit: string) => ({
      ...record(ownerId, unit),
      state: "synced" as const,
      syncedAt: NOW,
    });
    const own = sent("ann", "#01-01");
    const theirs = sent("ben", "#01-02");
    const unsent = record("ann", "#01-03");
    const held = { ...record("ann", "#01-04"), state: "held" as const };
    const queue = createMemoryQueue([own, theirs, unsent, held]);
    expect(await queue.deleteSentBy("ann")).toBe(1);
    expect((await queue.listAll()).map((r) => r.id).sort()).toEqual(
      [theirs.id, unsent.id, held.id].sort(),
    );
  });
});

describe("deleteUnsentBefore (#279)", () => {
  it("deletes unsent records saved at or before the cut-off, whoever's, and no sent ones", async () => {
    const old = { ...record("ann", "#01-01"), enqueuedAt: NOW - 10 };
    const edge = { ...record("ben", "#01-02"), enqueuedAt: NOW - 1, state: "held" as const };
    const recent = { ...record("ann", "#01-03"), enqueuedAt: NOW };
    const sent = {
      ...record("ann", "#01-04"),
      enqueuedAt: 1,
      state: "synced" as const,
      syncedAt: NOW,
    };
    const queue = createMemoryQueue([old, edge, recent, sent]);

    expect(await queue.deleteUnsentBefore(NOW - 1)).toBe(2);
    expect((await queue.listAll()).map((r) => r.id).sort()).toEqual([recent.id, sent.id].sort());
  });
});
