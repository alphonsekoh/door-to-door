import { describe, expect, it } from "vitest";
import type { FollowUp, SessionHousehold } from "@/generated/types.gen";
import {
  REMOVE_BLOCKED,
  householdState,
  membersSee,
  pickNote,
  removeBlocker,
  startBlocker,
  stateLabel,
} from "@/lib/follow-ups/session-households";

const owed = { doneAt: null } as FollowUp;
const done = { doneAt: "2026-10-20T10:00:00.000Z" } as FollowUp;
/* Resolved in March, months before the household was picked. */
const doneLongAgo = { doneAt: "2026-03-28T10:00:00.000Z" } as FollowUp;

function entry(over: Partial<SessionHousehold> = {}): SessionHousehold {
  return {
    household: { id: "h1" } as SessionHousehold["household"],
    block: { id: "b1" } as SessionHousehold["block"],
    addedAt: "2026-10-18T09:00:00.000Z",
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
    [
      "its note done after the pick, before it started",
      { notes: [done], onList: false },
      "done_before",
    ],
    [
      "done the moment it was picked",
      { notes: [{ doneAt: "2026-10-18T09:00:00.000Z" } as FollowUp], onList: false },
      "done_before",
    ],
    ["every note taken off the follow-up list", { notes: [], onList: false }, "off_list"],
    [
      // The owed note was removed; an old resolved one is not why it was picked.
      "its owed note taken off the list, an older one long done",
      { notes: [doneLongAgo], onList: false },
      "off_list",
    ],
    [
      "an old done note beside the one done since the pick",
      { notes: [done, doneLongAgo], onList: false },
      "done_before",
    ],
  ])("%s", (_case, over, state) => {
    expect(householdState(entry(over))).toBe(state);
  });
});

describe("pickNote", () => {
  const note = (id: string, doneAt: string | null) => ({ id, doneAt }) as FollowUp;
  /* Picked on 18 Oct 09:00. */
  const march = note("march", "2026-03-28T10:00:00.000Z");
  const pamphlet = note("pamphlet", "2026-10-21T10:00:00.000Z");

  it("names the note still owed, ahead of any resolved", () => {
    expect(pickNote(entry({ notes: [note("owed", null), pamphlet] }))?.id).toBe("owed");
  });

  it("names the note resolved today, never the one resolved in March", () => {
    // The server's order: owed, then the most recently resolved first.
    expect(pickNote(entry({ notes: [pamphlet, march] }))?.id).toBe("pamphlet");
  });

  it("names none when every note was resolved before the pick", () => {
    expect(pickNote(entry({ notes: [march] }))).toBeNull();
    expect(pickNote(entry({ notes: [] }))).toBeNull();
  });

  it("counts from the pick, to the minute", () => {
    expect(pickNote(entry({ notes: [note("at the pick", "2026-10-18T09:00:00.000Z")] }))?.id).toBe(
      "at the pick",
    );
    expect(pickNote(entry({ notes: [note("before", "2026-10-18T08:59:00.000Z")] }))).toBeNull();
  });

  it("never names a note resolved in the session before the household was added to it", () => {
    // Started 19 Oct; note A done 20 Oct; the door added 21 Oct for note B,
    // which an admin then took off the follow-up list.
    const addedMidway = entry({ addedAt: "2026-10-21T09:00:00.000Z" });
    const doneBeforeAdded = note("A", "2026-10-20T12:00:00.000Z");
    expect(pickNote({ ...addedMidway, notes: [doneBeforeAdded] })).toBeNull();
    const doneSince = note("B", "2026-10-21T12:00:00.000Z");
    expect(pickNote({ ...addedMidway, notes: [doneSince, doneBeforeAdded] })?.id).toBe("B");
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
  const elsewhere = entry({
    household: { id: "h3" } as SessionHousehold["household"],
    block: { id: "b2" } as SessionHousehold["block"],
  });
  /* This session's visits in each block, as the session page reads them. */
  const visitsIn = (counts: Record<string, number>) =>
    Object.entries(counts).map(([id, visitCount]) => ({
      block: { id } as SessionHousehold["block"],
      visitCount,
    }));

  it("lets a household go while another stays and nobody has knocked", () => {
    expect(removeBlocker(entry(), two, "active", visitsIn({ b1: 0 }))).toBeNull();
  });

  it("refuses as the server would", () => {
    expect(removeBlocker(entry(), two, "ended", [])).toBe("ended");
    expect(removeBlocker(entry({ visitedInSession: true }), two, "draft", [])).toBe("visited");
    expect(removeBlocker(entry(), [entry()], "draft", [])).toBe("last");
  });

  it("says visited before last, in the server's order", () => {
    expect(removeBlocker(entry({ visitedInSession: true }), [entry()], "active", [])).toBe(
      "visited",
    );
  });

  it("keeps the last pick in a block that holds this session's visits", () => {
    // An admin recorded off the list in b1, at a door nobody picked.
    expect(removeBlocker(entry(), [entry(), elsewhere], "active", visitsIn({ b1: 1 }))).toBe(
      "block_in_use",
    );
  });

  it("lets a pick go from a block with visits while another pick keeps the block", () => {
    expect(removeBlocker(entry(), [...two, elsewhere], "active", visitsIn({ b1: 2 }))).toBeNull();
  });

  it("lets the last pick in a block go once its block has no visits, or is not read yet", () => {
    expect(removeBlocker(entry(), [entry(), elsewhere], "active", visitsIn({ b2: 3 }))).toBeNull();
    expect(removeBlocker(entry(), [entry(), elsewhere], "active", [])).toBeNull();
  });

  it("says why in words", () => {
    expect(REMOVE_BLOCKED.visited).toBe("Visited in this session, so it stays.");
    expect(REMOVE_BLOCKED.last).toBe(
      "A follow-up session needs at least one household, so the last one can't be removed.",
    );
    expect(REMOVE_BLOCKED.block_in_use).toBe(
      "Its block has visits recorded in this session, so it stays.",
    );
  });
});

describe("membersSee", () => {
  const on = entry();
  const off = entry({ onList: false, notes: [] });

  it("says nothing while members see every pick, or once it has ended", () => {
    expect(membersSee([on, on], "active")).toBeNull();
    expect(membersSee([on, off], "ended")).toBeNull();
  });

  it("counts what members see of the picks", () => {
    expect(membersSee([on, off, off], "active")).toBe("Members see 1 of these.");
    expect(membersSee([off], "active")).toBe("Members see none of these right now.");
    expect(membersSee([on, off], "draft")).toBe("Members will see 1 of these.");
    expect(membersSee([off], "draft")).toBe("Members would see none of these.");
  });
});

describe("startBlocker", () => {
  it("holds Start only once the picks are read and none is owed", () => {
    expect(startBlocker(null)).toBeNull();
    expect(startBlocker(2)).toBeNull();
    expect(startBlocker(0)).toBe(
      "Every household here is done or off the follow-up list, so members would find nothing to visit. Add households to start it.",
    );
  });
});
