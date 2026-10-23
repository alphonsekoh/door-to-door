import { describe, expect, it } from "vitest";
import type { FollowUp } from "@/generated/types.gen";
import { DECLINED_WINDOW_MS, declinedSuggestions } from "@/lib/follow-ups/declined";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const ALICE = { id: "alice", name: "Alice", image: null };
const ADMIN = { id: "admin", name: "Admin", image: null };

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
    createdAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("declinedSuggestions", () => {
  it("keeps suggestions an admin removed, not yet acknowledged", () => {
    const notes = [
      removed("declined"),
      removed("withdrawn", { deletedBy: ALICE }),
      removed("listed then removed", { status: "listed" }),
      removed("live", { deletedAt: null, deletedBy: null }),
      removed("no remover", { deletedBy: null }),
      removed("seen"),
    ];
    expect(declinedSuggestions(notes, NOW, new Set(["seen"])).map((n) => n.id)).toEqual([
      "declined",
    ]);
  });

  it("stops telling the member after thirty days", () => {
    const edge = removed("edge", { deletedAt: new Date(NOW - DECLINED_WINDOW_MS).toISOString() });
    const old = removed("old", {
      deletedAt: new Date(NOW - DECLINED_WINDOW_MS - 1).toISOString(),
    });
    expect(declinedSuggestions([edge, old], NOW, new Set()).map((n) => n.id)).toEqual(["edge"]);
  });
});
