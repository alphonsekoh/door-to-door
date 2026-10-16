import { describe, expect, it } from "vitest";
import { zCreateVisitRequest, zVisitSyncItem } from "@/generated/zod.gen";
import { type VisitDraft, buildQueuedVisit, buildVisitRequest } from "@/lib/sync/enqueue";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

const draft: VisitDraft = {
  blockId: "0190a000-0000-7000-8000-0000000000bb",
  unitNumber: " 05-123 ",
  interestLevel: "high",
  description: "Asked about Sunday.",
  name: "  Tan  ",
  contact: "",
  religion: "",
  sessionId: "0190a000-0000-7000-8000-0000000000cc",
};

describe("buildQueuedVisit", () => {
  it("builds a new record due now, stamped with the moment of saving", () => {
    const record = buildQueuedVisit(draft, "ann", NOW);
    const stamp = new Date(NOW).toISOString();
    expect(record).toMatchObject({
      ownerId: "ann",
      state: "queued",
      attempts: 0,
      skewCount: 0,
      nextAttemptAt: NOW,
      enqueuedAt: NOW,
      lastError: null,
      syncedAt: null,
      serverVisit: null,
    });
    expect(record.item).toMatchObject({ clientCreatedAt: stamp, updatedAt: stamp, id: record.id });
    expect(zVisitSyncItem.safeParse(record.item).success).toBe(true);
  });

  it("uses a UUIDv7 for the id, the key that makes a replay harmless", () => {
    const record = buildQueuedVisit(draft, "ann", NOW);
    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(buildQueuedVisit(draft, "ann", NOW, () => "fixed").id).toBe("fixed");
  });

  it("sends a blank identity field as null, never as an empty string (D-25-6)", () => {
    const { item } = buildQueuedVisit(draft, "ann", NOW);
    expect(item).toMatchObject({
      name: "Tan",
      contact: null,
      religion: null,
      unitNumber: "#05-123",
    });
    expect(buildQueuedVisit({ ...draft, religion: "hindu" }, "ann", NOW).item.religion).toBe(
      "hindu",
    );
  });

  it("names the outing it was saved in", () => {
    expect(buildQueuedVisit(draft, "ann", NOW).item.sessionId).toBe(draft.sessionId);
  });
});

describe("buildVisitRequest", () => {
  it("builds a direct save with the same values and no outing, which the server stamps", () => {
    const request = buildVisitRequest(draft, NOW, () => "fixed");
    expect(request).toEqual({
      id: "fixed",
      blockId: draft.blockId,
      unitNumber: "#05-123",
      interestLevel: "high",
      description: "Asked about Sunday.",
      clientCreatedAt: new Date(NOW).toISOString(),
      name: "Tan",
      contact: null,
      religion: null,
    });
    expect(zCreateVisitRequest.safeParse(buildVisitRequest(draft, NOW)).success).toBe(true);
  });
});
