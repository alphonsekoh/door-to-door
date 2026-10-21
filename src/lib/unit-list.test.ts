import { describe, expect, it } from "vitest";
import type { HouseholdSummary, InterestLevel } from "@/generated/types.gen";
import {
  compareUnits,
  filterUnits,
  groupByFloor,
  matchesQuery,
  progressLabel,
  summariseProgress,
} from "@/lib/unit-list";

type Options = {
  name?: string | null;
  contact?: string | null;
  interestLevel?: InterestLevel | null;
  sessionId?: string;
};

function unit(unitNumber: string, options: Options = {}): HouseholdSummary {
  const { name = null, contact = null, interestLevel = "low", sessionId = "s1" } = options;
  return {
    household: {
      id: unitNumber,
      blockId: "b1",
      unitNumber,
      name,
      contact,
      religion: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    visitCount: 1,
    latestVisit:
      interestLevel === null
        ? null
        : {
            id: `v-${unitNumber}`,
            householdId: unitNumber,
            sessionId,
            member: { id: "u1", name: "Ben", image: null },
            team: null,
            interestLevel,
            description: "",
            clientCreatedAt: "2026-08-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
    outstandingFollowUps: 0,
  };
}

describe("compareUnits", () => {
  it("orders by unit number arithmetically, not as text", () => {
    // The bug this exists to stop: "#05-10" sorting before "#05-9".
    expect(compareUnits("#05-9", "#05-10")).toBeLessThan(0);
  });

  it("orders by floor before unit", () => {
    expect(compareUnits("#12-01", "#05-99")).toBeGreaterThan(0);
  });

  it("falls back to text when the numbering is not recognisable", () => {
    expect(compareUnits("Penthouse", "Annexe")).toBeGreaterThan(0);
    // Mixed pairs only reach here through the "Other units" group, which
    // holds nothing parseable - text order is all that is on offer.
    expect(compareUnits("#05-01", "Annexe")).toBe("#05-01".localeCompare("Annexe"));
  });
});

describe("groupByFloor", () => {
  it("groups units by floor and sorts both floors and units", () => {
    const floors = groupByFloor([unit("#12-03"), unit("#05-10"), unit("#05-9"), unit("#12-01")]);

    expect(floors.map((floor) => floor.label)).toEqual(["Floor 5", "Floor 12"]);
    expect(floors[0]?.units.map((entry) => entry.household.unitNumber)).toEqual([
      "#05-9",
      "#05-10",
    ]);
    expect(floors[1]?.units.map((entry) => entry.household.unitNumber)).toEqual([
      "#12-01",
      "#12-03",
    ]);
  });

  it("collects unrecognisable numbering last, under its own heading", () => {
    const floors = groupByFloor([unit("Penthouse"), unit("#03-01"), unit("Annexe")]);

    expect(floors.map((floor) => floor.label)).toEqual(["Floor 3", "Other units"]);
    expect(floors[1]?.units.map((entry) => entry.household.unitNumber)).toEqual([
      "Annexe",
      "Penthouse",
    ]);
  });

  it("returns nothing for an empty block", () => {
    expect(groupByFloor([])).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const units = [unit("#05-10"), unit("#05-01")];
    groupByFloor(units);
    expect(units[0]?.household.unitNumber).toBe("#05-10");
  });
});

describe("matchesQuery", () => {
  const entry = unit("#05-123", { name: "Mr Tan", contact: "91234567" });

  it("matches everything on an empty query", () => {
    expect(matchesQuery(entry, "   ")).toBe(true);
  });

  it("matches part of the unit number", () => {
    expect(matchesQuery(entry, "123")).toBe(true);
  });

  it("matches the unit number typed without punctuation", () => {
    // Typing # and - costs two keyboard layout switches on a phone.
    expect(matchesQuery(entry, "05123")).toBe(true);
  });

  it("matches the name regardless of case", () => {
    expect(matchesQuery(entry, "tan")).toBe(true);
  });

  it("matches the contact", () => {
    expect(matchesQuery(entry, "9123")).toBe(true);
  });

  it("does not match an unrelated string", () => {
    expect(matchesQuery(entry, "zzz")).toBe(false);
  });

  it("copes with a household nobody has answered at", () => {
    expect(matchesQuery(unit("#05-123"), "tan")).toBe(false);
  });
});

describe("filterUnits", () => {
  it("keeps only the matching units", () => {
    const units = [unit("#05-01", { name: "Mr Tan" }), unit("#06-02", { name: "Ms Lim" })];
    expect(filterUnits(units, "lim").map((entry) => entry.household.unitNumber)).toEqual([
      "#06-02",
    ]);
  });
});

describe("summariseProgress", () => {
  it("counts units, distinct floors and answered doors", () => {
    expect(
      summariseProgress([
        unit("#05-01", { interestLevel: "high" }),
        unit("#05-02", { interestLevel: "no_response" }),
        unit("#06-01", { interestLevel: "low" }),
      ]),
    ).toEqual({ units: 3, floors: 2, answered: 2 });
  });

  it("counts a household with no visit as unanswered", () => {
    expect(summariseProgress([unit("#05-01", { interestLevel: null })])).toEqual({
      units: 1,
      floors: 1,
      answered: 0,
    });
  });

  it("treats each unrecognisable unit as its own floor rather than merging them", () => {
    expect(summariseProgress([unit("Penthouse"), unit("Annexe")]).floors).toBe(2);
  });

  it("reports an empty block as no work done", () => {
    expect(summariseProgress([])).toEqual({ units: 0, floors: 0, answered: 0 });
  });
});

describe("progressLabel", () => {
  it("reads as one phrase", () => {
    expect(progressLabel({ units: 12, floors: 3, answered: 5 }, "Tonight")).toBe(
      "Tonight: 12 units on 3 floors, 5 answered",
    );
  });

  it("uses the singular for a single unit on a single floor", () => {
    expect(progressLabel({ units: 1, floors: 1, answered: 0 }, "Tonight")).toBe(
      "Tonight: 1 unit on 1 floor, 0 answered",
    );
  });

  it("names its scope, because the tab beside it counts something else", () => {
    // "All units (40)" next to a bare "36 units" reads as a contradiction.
    expect(progressLabel({ units: 4, floors: 1, answered: 1 }, "On this block")).toBe(
      "On this block: 4 units on 1 floor, 1 answered",
    );
  });
});
