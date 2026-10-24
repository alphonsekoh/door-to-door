import { describe, expect, it } from "vitest";
import type { FollowUp, SessionHousehold } from "@/generated/types.gen";
import {
  REMOVE_BLOCKED,
  householdState,
  removeBlocker,
  stateLabel,
} from "@/lib/follow-ups/session-households";

const owed = { doneAt: null } as FollowUp;
const done = { doneAt: "2026-10-20T10:00:00.000Z" } as FollowUp;

function entry(over: Partial<SessionHousehold> = {}): SessionHousehold {
  return {
    household: { id: "h1" } as SessionHousehold["household"],
    block: { id: "b1" } as SessionHousehold["block"],
    notes: [owed],
    onList: true,
    visitedInSession: false,
    ...over,
  };
}

describe("householdState", () => {
  it.each<[string, Partial<SessionHousehold>, string]>([
    ["owed and not yet visited", {}, "to_visit"],
    ["visited in this session", { visitedInSession: true }, "visited"],
    ["every note done in this session", { notes: [done], visitedInSession: true }, "done"],
    ["one note done, one still owed", { notes: [done, owed] }, "to_visit"],
    ["every note done before it started", { notes: [done], onList: false }, "done_before"],
    ["every note taken off the follow-up list", { notes: [], onList: false }, "off_list"],
  ])("%s", (_case, over, state) => {
    expect(householdState(entry(over))).toBe(state);
  });
});

describe("stateLabel", () => {
  it("says nothing for a household still to visit", () => {
    expect(stateLabel("to_visit", "active")).toBeNull();
  });

  it("names each other state, a resolved note by when it was done", () => {
    expect(stateLabel("visited", "active")).toBe("Visited");
    expect(stateLabel("done", "active")).toBe("Done");
    expect(stateLabel("done_before", "draft")).toBe("Already done");
    expect(stateLabel("done_before", "active")).toBe("Done before it started");
    expect(stateLabel("off_list", "ended")).toBe("Off the follow-up list");
  });
});

describe("removeBlocker", () => {
  const two = [entry(), entry({ household: { id: "h2" } as SessionHousehold["household"] })];

  it("lets a household go while another stays and nobody has knocked", () => {
    expect(removeBlocker(entry(), two, "active")).toBeNull();
  });

  it("refuses as the server would", () => {
    expect(removeBlocker(entry(), two, "ended")).toBe("ended");
    expect(removeBlocker(entry({ visitedInSession: true }), two, "draft")).toBe("visited");
    expect(removeBlocker(entry(), [entry()], "draft")).toBe("last");
  });

  it("says why in words", () => {
    expect(REMOVE_BLOCKED.visited).toBe("Visited in this session, so it stays.");
    expect(REMOVE_BLOCKED.last).toBe(
      "A follow-up session needs at least one household, so the last one can't be removed.",
    );
  });
});
