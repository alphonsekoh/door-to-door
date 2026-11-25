import { describe, expect, it } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import {
  CORRUPT,
  HOUSEHOLD_ERASED,
  isCorrupt,
  isErased,
  isExpired,
  isSent,
  isUnsentBefore,
  readRecord,
} from "@/lib/sync/record";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

const good = buildQueuedVisit(
  {
    blockId: "0190a000-0000-7000-8000-0000000000bb",
    unitNumber: "#05-01",
    interestLevel: "medium",
    description: "Came to the door.",
    name: "Tan",
    contact: "",
    religion: "",
    sessionId: "0190a000-0000-7000-8000-0000000000cc",
  },
  "ann",
  NOW,
);

describe("readRecord", () => {
  it("passes a well-formed record through untouched", () => {
    expect(readRecord(structuredClone(good))).toEqual(good);
  });

  it("stops a record whose item no longer matches the contract, keeping its id and owner", () => {
    const broken = { ...good, item: { ...good.item, interestLevel: "keen" } };
    const read = readRecord(broken);
    expect(read).toMatchObject({
      id: good.id,
      ownerId: "ann",
      state: "quarantined",
      nextAttemptAt: null,
      lastError: { code: CORRUPT },
      enqueuedAt: NOW,
    });
    expect(isCorrupt(read)).toBe(true);
  });

  it("never sends a stored record that does not name its outing", () => {
    const { sessionId: _outing, ...withoutOuting } = good.item;
    expect(isCorrupt(readRecord({ ...good, item: withoutOuting }))).toBe(true);
  });

  it("sends again a record whose bookkeeping is damaged but whose knock and owner are intact", () => {
    const fresh = {
      ...good,
      state: "queued",
      attempts: 0,
      skewCount: 0,
      nextAttemptAt: 0,
      lastError: null,
      syncedAt: null,
      serverVisit: null,
    };
    expect(readRecord({ ...good, state: "sending", attempts: 4 })).toEqual(fresh);
    expect(
      readRecord({ ...good, state: "held", attempts: -1, lastError: { code: "conflict" } }),
    ).toEqual(fresh);
    // Claiming to be sent is bookkeeping too: a replay is answered unchanged.
    expect(readRecord({ ...good, state: "synced", syncedAt: "yesterday" })).toEqual(fresh);
    expect(isCorrupt(readRecord({ ...good, skewCount: null }))).toBe(false);
  });

  it("keeps a salvaged record's place in the queue only when its time is readable", () => {
    expect(readRecord({ ...good, attempts: -1 }).enqueuedAt).toBe(NOW);
    expect(readRecord({ ...good, attempts: -1, enqueuedAt: "noon" }).enqueuedAt).toBe(0);
  });

  it("does not salvage a record whose owner is lost, so it is never sent as anyone", () => {
    const { ownerId: _owner, ...ownerless } = good;
    expect(readRecord({ ...ownerless, attempts: -1 })).toMatchObject({
      ownerId: "",
      state: "quarantined",
      lastError: { code: CORRUPT },
    });
    expect(isCorrupt(readRecord({ ...good, ownerId: 42, attempts: -1 }))).toBe(true);
  });

  it("does not salvage a record whose knock is damaged along with its bookkeeping", () => {
    const read = readRecord({ ...good, attempts: -1, item: { ...good.item, unitNumber: 5 } });
    expect(isCorrupt(read)).toBe(true);
    expect(read.item.unitNumber).toBe("");
  });

  it("never sends a record whose id is not its knock's, since its result could not be matched", () => {
    const other = "0190a000-0000-7000-8000-0000000000dd";
    const salvageable = readRecord({ ...good, attempts: -1, item: { ...good.item, id: other } });
    expect(salvageable).toMatchObject({
      id: good.id,
      ownerId: "ann",
      state: "quarantined",
      lastError: { code: CORRUPT },
    });
    expect(salvageable.item.id).toBe(good.id);
    expect(isCorrupt(readRecord({ ...good, item: { ...good.item, id: other } }))).toBe(true);
  });

  it("makes something of a record with almost nothing left", () => {
    expect(readRecord({ id: 7 })).toMatchObject({ id: "7", ownerId: "", enqueuedAt: 0 });
    expect(readRecord("junk")).toMatchObject({ id: "undefined", state: "quarantined" });
  });

  it("does not take a record stopped for another reason as unreadable", () => {
    expect(isCorrupt({ ...good, state: "quarantined", lastError: { code: "invalid" } })).toBe(
      false,
    );
    expect(isCorrupt(good)).toBe(false);
  });
});

describe("isExpired", () => {
  it("expires only records sent before the cut-off", () => {
    const sent = { ...good, state: "synced" as const, syncedAt: NOW };
    expect(isExpired(sent, NOW + 1)).toBe(true);
    expect(isExpired(sent, NOW)).toBe(false);
    expect(isExpired({ ...sent, syncedAt: null }, NOW + 1)).toBe(false);
    expect(isExpired({ ...good, syncedAt: NOW }, NOW + 1)).toBe(false);
  });
});

describe("isSent", () => {
  it("is any record sent, however recently, and nothing else", () => {
    const sent = { ...good, state: "synced" as const, syncedAt: Date.now() };
    expect(isSent(sent)).toBe(true);
    expect(isSent({ ...sent, syncedAt: null })).toBe(false);
    for (const state of ["queued", "failed", "held", "quarantined"] as const) {
      expect(isSent({ ...sent, state })).toBe(false);
    }
  });
});

describe("isErased and isUnsentBefore (#279)", () => {
  const stub = {
    ...good,
    state: "synced" as const,
    syncedAt: NOW,
    lastError: { code: HOUSEHOLD_ERASED },
  };

  it("knows a stub by its state and its refusal, and a sent record is not one", () => {
    expect(isErased(stub)).toBe(true);
    expect(isErased({ ...stub, lastError: null })).toBe(false);
    expect(isErased({ ...stub, state: "held" })).toBe(false);
  });

  it("expires a stub with the sent records, after their 24 hours", () => {
    expect(isExpired(stub, NOW + 1)).toBe(true);
    expect(isExpired(stub, NOW)).toBe(false);
    expect(isSent(stub)).toBe(true);
  });

  it("counts a record unsent in any state but sent, up to and including the time", () => {
    for (const state of ["queued", "failed", "held", "quarantined"] as const) {
      expect(isUnsentBefore({ ...good, state, enqueuedAt: NOW }, NOW)).toBe(true);
      expect(isUnsentBefore({ ...good, state, enqueuedAt: NOW + 1 }, NOW)).toBe(false);
    }
    expect(isUnsentBefore({ ...good, state: "synced", enqueuedAt: 0 }, NOW)).toBe(false);
  });
});
