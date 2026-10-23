import { describe, expect, it } from "vitest";
import type { RevisitEntry } from "@/generated/types.gen";
import {
  groupByBlock,
  listedUnitsIn,
  progress,
  revisitState,
  unitGate,
} from "@/lib/follow-ups/revisits";

const STAMP = "2026-10-20T18:00:00.000Z";

function entry(
  blockId: string,
  unitNumber: string,
  { done = [false], visited = false }: { done?: boolean[]; visited?: boolean } = {},
): RevisitEntry {
  const householdId = `${blockId}-${unitNumber}`;
  return {
    household: {
      id: householdId,
      blockId,
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: { id: blockId, name: blockId, street: "Ave 3", postalCode: null, createdAt: STAMP },
    notes: done.map((resolved, i) => ({
      id: `${householdId}-${String(i)}`,
      householdId,
      blockId,
      blockName: blockId,
      unitNumber,
      visitId: null,
      status: "listed",
      author: { id: "admin", name: "Admin", image: null },
      note: "Go back",
      dueDate: null,
      doneAt: resolved ? STAMP : null,
      doneBy: null,
      listedAt: STAMP,
      listedBy: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      createdAt: STAMP,
    })),
    latestVisit: null,
    visitedInSession: visited,
  };
}

const list = [
  entry("123", "#01-01"),
  entry("123", "#02-02", { visited: true }),
  entry("125", "#01-01", { done: [true, true] }),
];

describe("groupByBlock", () => {
  it("keeps the server's order, one group per block", () => {
    expect(
      groupByBlock(list).map((group) => [
        group.block.id,
        group.entries.map((e) => e.household.unitNumber),
      ]),
    ).toEqual([
      ["123", ["#01-01", "#02-02"]],
      ["125", ["#01-01"]],
    ]);
    expect(groupByBlock([])).toEqual([]);
  });
});

describe("revisitState and progress", () => {
  it("is done once every note is resolved, else visited or still to visit", () => {
    expect(list.map(revisitState)).toEqual(["to_visit", "visited", "done"]);
    expect(revisitState(entry("123", "#03-03", { done: [true, false], visited: true }))).toBe(
      "visited",
    );
  });

  it("counts visited and done households against the whole list", () => {
    expect(progress(list)).toBe("2 of 3 visited");
    expect(progress([])).toBe("0 of 0 visited");
  });
});

describe("listedUnitsIn", () => {
  it("lists one block's units with their state", () => {
    expect(listedUnitsIn(list, "123")).toEqual([
      { householdId: "123-#01-01", unitNumber: "#01-01", state: "to_visit" },
      { householdId: "123-#02-02", unitNumber: "#02-02", state: "visited" },
    ]);
    expect(listedUnitsIn(list, "999")).toEqual([]);
  });
});

describe("unitGate", () => {
  it.each<[string, string, string, RevisitEntry[] | null, boolean, string]>([
    ["a listed unit", "#01-01", "123", list, false, "ok"],
    ["a listed unit typed loosely", " 01-01 ", "123", list, false, "ok"],
    ["the same unit in another block", "#02-02", "125", list, false, "unlisted"],
    ["an unlisted unit, for a member", "#09-09", "123", list, false, "unlisted"],
    ["an unlisted unit, for an admin", "#09-09", "123", list, true, "admin_override"],
    ["a list that could not be read, for a member", "#09-09", "123", null, false, "unknown"],
    ["a list that could not be read, for an admin", "#09-09", "123", null, true, "ok"],
    ["nothing typed yet", "  ", "123", list, false, "ok"],
  ])("%s", (_case, unit, blockId, revisits, isAdmin, expected) => {
    expect(unitGate(unit, blockId, revisits, isAdmin)).toBe(expected);
  });
});
