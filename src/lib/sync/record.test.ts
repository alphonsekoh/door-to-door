import { describe, expect, it } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { CORRUPT, isCorrupt, isExpired, readRecord } from "@/lib/sync/record";

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

  it("stops a record whose bookkeeping is damaged", () => {
    expect(readRecord({ ...good, state: "sending" }).state).toBe("quarantined");
    expect(readRecord({ ...good, attempts: -1 }).lastError).toEqual({ code: CORRUPT });
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
