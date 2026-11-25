import { describe, expect, it } from "vitest";
import type { HouseholdSummary } from "@/generated/types.gen";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";
import { overlayQueued } from "@/lib/sync/unit-overlay";

const BLOCK = "0190a000-0000-7000-8000-0000000000bb";
const TONIGHT = "0190a000-0000-7000-8000-0000000000cc";
const LAST_WEEK = "0190a000-0000-7000-8000-0000000000dd";
const NOW = Date.parse("2026-10-15T10:00:00.000Z");

function server(unitNumber: string, sessionId = LAST_WEEK): HouseholdSummary {
  return {
    household: {
      id: `h-${unitNumber}`,
      blockId: BLOCK,
      unitNumber,
      name: "Lim",
      contact: null,
      religion: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    visitCount: 1,
    latestVisit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId,
      member: { id: "ben", name: "Ben" },
      team: null,
      interestLevel: "low",
      description: "",
      clientCreatedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

function queued(
  unitNumber: string,
  options: Partial<{ at: number; block: string; session: string; name: string }> = {},
): QueuedVisit {
  return buildQueuedVisit(
    {
      blockId: options.block ?? BLOCK,
      unitNumber,
      interestLevel: "high",
      description: "",
      name: options.name ?? "",
      contact: "",
      religion: "",
      sessionId: options.session ?? TONIGHT,
    },
    "ann",
    options.at ?? NOW,
  );
}

describe("overlayQueued", () => {
  it("shows the server's units unchanged when nothing is waiting", () => {
    const rows = overlayQueued([server("#05-01")], [], BLOCK, TONIGHT);
    expect(rows).toEqual([
      expect.objectContaining({
        key: "h-#05-01",
        pending: null,
        tonight: false,
        latestVisit: server("#05-01").latestVisit,
      }),
    ]);
  });

  it("marks a server unit tonight by its latest visit", () => {
    expect(overlayQueued([server("#05-01", TONIGHT)], [], BLOCK, TONIGHT)[0]?.tonight).toBe(true);
    expect(overlayQueued([server("#05-01", TONIGHT)], [], BLOCK, null)[0]?.tonight).toBe(false);
  });

  it("lays a waiting record over the unit it belongs to, newest winning", () => {
    const older = queued("05-01", { at: NOW - 10 });
    const newer = queued("#05-01", { at: NOW });
    const rows = overlayQueued([server("#05-01")], [newer, older], BLOCK, TONIGHT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pending: newer,
      latestVisit: { interestLevel: "high" },
      tonight: true,
    });
  });

  it("adds a unit only this phone knows about as a row of its own", () => {
    const record = queued("#07-01", { name: "Tan" });
    const rows = overlayQueued([server("#05-01")], [record], BLOCK, TONIGHT);
    expect(rows[1]).toEqual({
      key: `queued:${record.id}`,
      household: { unitNumber: "#07-01", name: "Tan", contact: null },
      entry: null,
      pending: record,
      latestVisit: { interestLevel: "high" },
      tonight: true,
    });
  });

  it("does not count a record from another outing as tonight's", () => {
    const rows = overlayQueued([], [queued("#07-01", { session: LAST_WEEK })], BLOCK, TONIGHT);
    expect(rows[0]?.tonight).toBe(false);
    expect(overlayQueued([], [queued("#07-01")], BLOCK, null)[0]?.tonight).toBe(false);
  });

  it("ignores sent records and other blocks", () => {
    const sent = { ...queued("#07-01"), state: "synced" as const };
    const elsewhere = queued("#07-02", { block: "0190a000-0000-7000-8000-0000000000ee" });
    expect(overlayQueued([], [sent, elsewhere], BLOCK, TONIGHT)).toEqual([]);
  });
});

describe("an erased stub (#279)", () => {
  it("is laid over nothing: it holds no unit, and was never sent as one", () => {
    const stub: QueuedVisit = {
      ...queued("#05-02"),
      state: "synced",
      syncedAt: NOW,
      lastError: { code: "household_erased" },
    };
    expect(overlayQueued([server("#05-01")], [stub], BLOCK, TONIGHT, () => true)).toHaveLength(1);
    // A unit only this phone knew is not drawn for it either.
    expect(overlayQueued([], [stub], BLOCK, TONIGHT)).toEqual([]);
  });
});
