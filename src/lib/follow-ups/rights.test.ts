import { describe, expect, it } from "vitest";
import type { ActiveSession, FollowUp, SessionKind } from "@/generated/types.gen";
import {
  type FollowUpRights,
  followUpRights,
  householdAction,
  marksDoneOnSave,
  onActiveList,
  waitingCaption,
  waitingLabel,
} from "@/lib/follow-ups/rights";

const HOUSEHOLD = "h1";
const STARTED = "2026-10-20T18:00:00.000Z";
const ALICE = { id: "alice", name: "Alice Tan", image: null };
const BEN = { id: "ben", name: "Ben Lim", image: null };

function note(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "n1",
    householdId: HOUSEHOLD,
    blockId: "b1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    status: "listed",
    author: ALICE,
    note: "Bring the booklet",
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

/* Picked the day before it started, as a draft's households are. */
const PICKED = "2026-10-19T18:00:00.000Z";
/* Added to the running session for another note, an hour in. */
const ADDED_LATER = "2026-10-20T19:00:00.000Z";

function running(
  kind: SessionKind,
  picks = [{ householdId: HOUSEHOLD, addedAt: PICKED }],
  startedAt: string | null = STARTED,
) {
  return {
    session: {
      id: "s1",
      title: "Tonight",
      kind,
      status: "active",
      startedAt,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: STARTED,
    },
    blocks: [
      {
        block: { id: "b1", name: "123", street: "Ave 3", postalCode: null, createdAt: STARTED },
        visitCount: 0,
        householdCount: 0,
        activeMembers: [],
      },
    ],
    picks,
  } satisfies ActiveSession;
}

const followUp = running("follow_up");
const pickedMidway = running("follow_up", [{ householdId: HOUSEHOLD, addedAt: ADDED_LATER }]);

describe("onActiveList", () => {
  it.each<[string, FollowUp, ActiveSession | null, boolean]>([
    ["a listed note owed, at a household the session picked", note(), followUp, true],
    [
      "one resolved during the session",
      note({ doneAt: "2026-10-20T19:00:00.000Z" }),
      followUp,
      true,
    ],
    [
      "one resolved before it started",
      note({ doneAt: "2026-10-19T19:00:00.000Z" }),
      followUp,
      false,
    ],
    ["a suggestion", note({ status: "suggested" }), followUp, false],
    ["a removed note", note({ deletedAt: STARTED }), followUp, false],
    ["a household the session did not pick", note({ householdId: "h2" }), followUp, false],
    ["a regular session", note(), running("regular"), false],
    ["no session running", note(), null, false],
    [
      "a resolved note when the session has no start",
      note({ doneAt: STARTED }),
      running("follow_up", undefined, null),
      false,
    ],
    [
      "one resolved during the session but before the household was added to it",
      note({ doneAt: "2026-10-20T18:30:00.000Z" }),
      pickedMidway,
      false,
    ],
    [
      "one resolved after the household was added to the running session",
      note({ doneAt: "2026-10-20T19:30:00.000Z" }),
      pickedMidway,
      true,
    ],
    ["one still owed at a household added midway", note(), pickedMidway, true],
  ])("%s: %s", (_case, subject, active, expected) => {
    expect(onActiveList(subject, active)).toBe(expected);
  });
});

describe("marksDoneOnSave", () => {
  it.each<[string, FollowUp, ActiveSession | null, boolean]>([
    ["a note owed on the running follow-up session's list", note(), followUp, true],
    [
      "one already resolved during the session",
      note({ doneAt: "2026-10-20T19:00:00.000Z" }),
      followUp,
      false,
    ],
    ["a household the session did not pick", note({ householdId: "h2" }), followUp, false],
    ["a suggestion", note({ status: "suggested" }), followUp, false],
    ["a regular session", note(), running("regular"), false],
    ["no session running", note(), null, false],
  ])("%s: %s", (_case, subject, active, expected) => {
    expect(marksDoneOnSave(subject, active)).toBe(expected);
  });
});

/* The server's rights table, row by row (src/server/follow-ups/service.ts). */
describe("followUpRights", () => {
  const none: FollowUpRights = {
    canResolve: false,
    canEditText: false,
    canRemove: false,
    canPromote: false,
    locked: false,
    waitingSuggestion: null,
  };
  /* Resolved during the session, with Ben's suggestion waiting at the door. */
  const waiting = note({ doneAt: "2026-10-20T19:00:00.000Z", waitingSuggestionBy: BEN });
  const admin = { userId: "admin", isAdmin: true };
  const alice = { userId: ALICE.id, isAdmin: false };
  const ben = { userId: BEN.id, isAdmin: false };

  it.each<
    [
      string,
      FollowUp,
      { userId: string | undefined; isAdmin: boolean },
      ActiveSession | null,
      FollowUpRights,
    ]
  >([
    [
      "an admin, on a listed note, any time",
      note(),
      admin,
      null,
      { ...none, canResolve: true, canEditText: true, canRemove: true },
    ],
    [
      "an admin, on a suggestion",
      note({ status: "suggested" }),
      admin,
      null,
      { ...none, canEditText: true, canRemove: true, canPromote: true },
    ],
    [
      "the author, on their suggestion",
      note({ status: "suggested" }),
      alice,
      null,
      { ...none, canEditText: true, canRemove: true },
    ],
    ["another member, on a suggestion", note({ status: "suggested" }), ben, followUp, none],
    [
      "the author, on a listed note in its session",
      note(),
      alice,
      followUp,
      { ...none, canResolve: true, canEditText: true },
    ],
    [
      "another member, on a listed note in its session",
      note(),
      ben,
      followUp,
      { ...none, canResolve: true },
    ],
    [
      "the author, on a listed note outside its session",
      note(),
      alice,
      null,
      { ...none, locked: true },
    ],
    ["a member, in a regular session", note(), ben, running("regular"), { ...none, locked: true }],
    [
      "someone not yet known",
      note(),
      { userId: undefined, isAdmin: false },
      followUp,
      { ...none, canResolve: true },
    ],
    [
      "an admin, reopening where a suggestion waits",
      waiting,
      admin,
      null,
      {
        ...none,
        canResolve: true,
        canEditText: true,
        canRemove: true,
        waitingSuggestion: { by: "Ben", mine: false },
      },
    ],
    [
      "a member in the session, where a suggestion waits",
      waiting,
      alice,
      followUp,
      { ...none, canEditText: true, waitingSuggestion: { by: "Ben", mine: false } },
    ],
    [
      "the member whose suggestion waits",
      waiting,
      ben,
      followUp,
      { ...none, waitingSuggestion: { by: "Ben", mine: true } },
    ],
    [
      "a member outside the session, where a suggestion waits",
      waiting,
      alice,
      null,
      { ...none, locked: true },
    ],
    [
      "a member on an owed note with a suggestion beside it",
      note({ waitingSuggestionBy: BEN }),
      alice,
      followUp,
      { ...none, canResolve: true, canEditText: true },
    ],
  ])("%s", (_case, subject, viewer, active, expected) => {
    expect(followUpRights(subject, viewer, active)).toEqual(expected);
  });
});

describe("householdAction", () => {
  const member = { userId: BEN.id, isAdmin: false };

  const admin = { userId: "admin", isAdmin: true };

  it("lets an admin list a household with nothing open", () => {
    expect(householdAction([], admin)).toEqual({ kind: "add_to_list" });
    expect(householdAction([note({ doneAt: STARTED })], admin)).toEqual({ kind: "add_to_list" });
  });

  it("has an admin add a waiting suggestion rather than write a second note", () => {
    const suggestion = note({ id: "s9", status: "suggested" });
    expect(householdAction([suggestion], admin)).toEqual({ kind: "promote", suggestion });
  });

  it("tells an admin the household is already on the list while a note is owed", () => {
    expect(householdAction([note()], admin)).toEqual({ kind: "listed" });
    expect(householdAction([note(), note({ status: "suggested" })], admin)).toEqual({
      kind: "listed",
    });
  });

  it("offers a member a suggestion when nothing is open", () => {
    expect(householdAction([], member)).toEqual({ kind: "suggest" });
    expect(householdAction([note({ doneAt: STARTED })], member)).toEqual({ kind: "suggest" });
  });

  it("says the household is on the list while a listed note is owed", () => {
    expect(householdAction([note(), note({ status: "suggested" })], member)).toEqual({
      kind: "listed",
    });
  });

  it("names who suggested it while the suggestion waits", () => {
    expect(householdAction([note({ status: "suggested" })], member)).toEqual({
      kind: "waiting",
      by: "Alice Tan",
    });
    expect(householdAction([note({ status: "suggested", author: BEN })], member)).toEqual({
      kind: "waiting",
      by: "you",
    });
  });

  it("reads as a sentence", () => {
    expect(waitingLabel("Alice Tan")).toBe("Suggested by Alice Tan, waiting for review");
  });
});

describe("waitingCaption", () => {
  it("tells an admin the reopen lists the suggestion too", () => {
    expect(waitingCaption({ by: "Ann", mine: false }, true)).toBe(
      "Reopening also adds Ann's suggestion to the list.",
    );
    expect(waitingCaption({ by: "Ann", mine: true }, true)).toBe(
      "Reopening also adds your suggestion to the list.",
    );
  });

  it("tells a member an admin reviews the suggestion first", () => {
    expect(waitingCaption({ by: "Ann", mine: false }, false)).toBe(
      "Ann's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
    expect(waitingCaption({ by: "Ann", mine: true }, false)).toBe(
      "Your suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });
});
