import { describe, expect, it } from "vitest";
import type { RevisitEntry } from "@/generated/types.gen";
import {
  groupByBlock,
  heldOffListKey,
  listedUnitsIn,
  progress,
  revisitState,
  unitGate,
} from "@/lib/follow-ups/revisits";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

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

  it("counts visited and done households against the whole list, as the rows say", () => {
    // One visited, one marked done without a knock: neither is still to visit.
    expect(progress(list)).toBe("2 of 3 visited or done");
    expect(progress([])).toBe("0 of 0 visited or done");
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
  it.each<[string, string, string, RevisitEntry[] | null | undefined, boolean, string]>([
    ["a listed unit", "#01-01", "123", list, false, "ok"],
    ["a listed unit typed loosely", " 01-01 ", "123", list, false, "ok"],
    ["the same unit in another block", "#02-02", "125", list, false, "unlisted"],
    ["an unlisted unit, for a member", "#09-09", "123", list, false, "unlisted"],
    ["an unlisted unit, for an admin", "#09-09", "123", list, true, "admin_override"],
    ["a list that could not be read, for a member", "#09-09", "123", null, false, "unknown"],
    ["a list that could not be read, for an admin", "#09-09", "123", null, true, "ok"],
    ["a list still being read, for a member", "#09-09", "123", undefined, false, "checking"],
    ["a list still being read, for an admin", "#09-09", "123", undefined, true, "ok"],
    ["nothing typed yet", "  ", "123", list, false, "ok"],
  ])("%s", (_case, unit, blockId, revisits, isAdmin, expected) => {
    expect(unitGate(unit, blockId, revisits, isAdmin)).toBe(expected);
  });
});

describe("heldOffListKey", () => {
  const record = (id: string, state: QueuedVisit["state"], code: string | null): QueuedVisit => ({
    ...buildQueuedVisit(
      {
        blockId: "123",
        unitNumber: "#01-01",
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: "s1",
      },
      "u1",
      Date.parse(STAMP),
      () => id,
    ),
    state,
    lastError: code === null ? null : { code },
  });

  it("names only the records the server held as off the list", () => {
    expect(
      heldOffListKey([
        record("a", "held", "not_on_follow_up_list"),
        record("b", "held", "session_not_active"),
        record("c", "queued", null),
        record("d", "synced", null),
        record("e", "held", "not_on_follow_up_list"),
      ]),
    ).toBe("a e");
    expect(heldOffListKey([])).toBe("");
  });
});
