import { describe, expect, it } from "vitest";
import type { FollowUp } from "@/generated/types.gen";
import { DECLINED_WINDOW_MS, authorNoticeLine, removedForAuthor } from "@/lib/follow-ups/declined";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const ALICE = { id: "alice", name: "Alice", image: null };
const ADMIN = { id: "admin", name: "Ben Lim", image: null };

function removed(id: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: "h1",
    blockId: "b1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    status: "suggested",
    author: ALICE,
    note: "Asked us back",
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: new Date(NOW - 60_000).toISOString(),
    deletedBy: ADMIN,
    deleteReason: "Already visited",
    waitingSuggestionBy: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

/* Local midday, so the day reads the same in any time zone the suite runs in. */
const MARCH_3 = new Date(2026, 2, 3, 12).toISOString();

describe("removedForAuthor", () => {
  it("keeps the member's notes someone else removed, not yet acknowledged", () => {
    const notes = [
      removed("declined"),
      removed("taken off the list", { status: "listed" }),
      removed("withdrawn", { deletedBy: ALICE }),
      removed("live", { deletedAt: null, deletedBy: null }),
      removed("no remover", { deletedBy: null }),
      removed("seen"),
    ];
    expect(removedForAuthor(notes, NOW, new Set(["seen"])).map((n) => n.id)).toEqual([
      "declined",
      "taken off the list",
    ]);
  });

  it("stops telling the member after thirty days", () => {
    const edge = removed("edge", { deletedAt: new Date(NOW - DECLINED_WINDOW_MS).toISOString() });
    const old = removed("old", {
      deletedAt: new Date(NOW - DECLINED_WINDOW_MS - 1).toISOString(),
    });
    expect(removedForAuthor([edge, old], NOW, new Set()).map((n) => n.id)).toEqual(["edge"]);
  });
});

describe("authorNoticeLine", () => {
  it("says a suggestion was declined, by whom, when and why", () => {
    expect(
      authorNoticeLine({
        status: "suggested",
        deletedAt: MARCH_3,
        deletedBy: ADMIN,
        deleteReason: "Already visited",
      }),
    ).toBe("Declined by Ben Lim · 3 Mar 2026: Already visited");
  });

  it("says a listed note was taken off the follow-up list", () => {
    expect(
      authorNoticeLine({
        status: "listed",
        deletedAt: MARCH_3,
        deletedBy: ADMIN,
        deleteReason: "The family has moved",
      }),
    ).toBe("Removed from the follow-up list by Ben Lim · 3 Mar 2026: The family has moved");
  });

  it("leaves the reason off a removal made before one was required", () => {
    expect(
      authorNoticeLine({
        status: "suggested",
        deletedAt: MARCH_3,
        deletedBy: null,
        deleteReason: null,
      }),
    ).toBe("Declined by Someone · 3 Mar 2026");
  });
});
