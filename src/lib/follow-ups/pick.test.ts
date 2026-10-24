import { describe, expect, it } from "vitest";
import type { FollowUp } from "@/generated/types.gen";
import {
  createBlocker,
  groupForPicking,
  householdIdsOf,
  moreNotes,
  pickSummary,
} from "@/lib/follow-ups/pick";

function note(householdId: string, blockName: string, unitNumber: string, text: string): FollowUp {
  return {
    id: `${householdId}:${text}`,
    householdId,
    blockId: `b${blockName}`,
    blockName,
    unitNumber,
    visitId: null,
    status: "listed",
    author: { id: "a", name: "Admin", image: null },
    note: text,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("groupForPicking", () => {
  const groups = groupForPicking([
    note("h3", "125", "#01-01", "Third"),
    note("h1", "123", "#10-01", "Soonest"),
    note("h2", "123", "#02-05", "Second"),
    note("h1", "123", "#10-01", "Later"),
    note("h4", "9", "#01-01", "Small block"),
  ]);

  it("groups by block, in block order with numbers read as numbers", () => {
    expect(groups.map((group) => group.blockName)).toEqual(["9", "123", "125"]);
  });

  it("lists each household once, by unit, with its first note and a count", () => {
    expect(groups[1]?.households).toEqual([
      expect.objectContaining({ householdId: "h2", unitNumber: "#02-05", notes: 1 }),
      expect.objectContaining({ householdId: "h1", unitNumber: "#10-01", notes: 2 }),
    ]);
    expect(groups[1]?.households[1]?.first.note).toBe("Soonest");
  });

  it("names every household in the order shown", () => {
    expect(householdIdsOf(groups)).toEqual(["h4", "h2", "h1", "h3"]);
  });

  it("is empty for an empty list", () => {
    expect(groupForPicking([])).toEqual([]);
  });
});

describe("moreNotes", () => {
  it("counts the notes beyond the first, and says nothing for one", () => {
    const [group] = groupForPicking([note("h1", "1", "#1", "a"), note("h1", "1", "#1", "b")]);
    const household = group?.households[0];
    if (household === undefined) throw new Error("expected a household");
    expect(moreNotes(household)).toBe("+1 more");
    expect(moreNotes({ ...household, notes: 1 })).toBeNull();
  });
});

describe("pickSummary", () => {
  it("reads as a count of households", () => {
    expect(pickSummary(3, 12)).toBe("3 of 12 households ticked");
    expect(pickSummary(1, 1)).toBe("1 of 1 household ticked");
  });
});

describe("createBlocker", () => {
  it("never holds up a door-to-door session", () => {
    expect(createBlocker("regular", "loading", 0, 0)).toBeNull();
  });

  it("says why a follow-up session cannot be created yet", () => {
    expect(createBlocker("follow_up", "loading", 0, 0)).toBe("Loading the follow-up list…");
    expect(createBlocker("follow_up", "error", 0, 0)).toBe("Could not load the follow-up list.");
    expect(createBlocker("follow_up", "ready", 0, 0)).toBe(
      "Add households to the follow-up list first.",
    );
    expect(createBlocker("follow_up", "ready", 4, 0)).toBe("Tick at least one household to visit.");
    expect(createBlocker("follow_up", "ready", 4, 1)).toBeNull();
  });
});
