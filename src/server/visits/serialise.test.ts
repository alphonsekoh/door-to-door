import { describe, expect, it } from "vitest";
import type { FollowUpRow } from "@/server/visits/queries";
import { toFollowUp, toHousehold, toRecordedVisit, toVisit } from "@/server/visits/serialise";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";

const at = new Date("2026-03-14T10:00:00.000Z");

const household: HouseholdRow = {
  id: "h1",
  blockId: "b1",
  unitNumber: "#05-123",
  name: "Mr Tan",
  contact: "+65 9000 0000",
  religion: "buddhist",
  createdAt: at,
  updatedAt: at,
};

const visit: VisitRow = {
  id: "v1",
  householdId: "h1",
  sessionId: "s1",
  teamId: null,
  team: null,
  interestLevel: "medium",
  description: "Listened for a while.",
  clientCreatedAt: at,
  createdAt: at,
  updatedAt: at,
  memberId: "u1",
  memberName: "Alice",
  memberImage: null,
};

const followUp: FollowUpRow = {
  id: "f1",
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: "v1",
  status: "listed",
  note: "Bring the flyer.",
  dueDate: at,
  doneAt: at,
  createdAt: at,
  authorId: "u1",
  authorName: "Alice",
  authorImage: null,
  doneById: "u2",
  doneByName: "Ben",
  doneByImage: null,
  listedAt: at,
  listedById: "u3",
  listedByName: "Admin",
  listedByImage: null,
  deletedAt: null,
  deletedById: null,
  deletedByName: null,
  deletedByImage: null,
  deleteReason: null,
  waitingSuggestionId: null,
  waitingById: null,
  waitingByName: null,
  waitingByImage: null,
};

describe("toHousehold", () => {
  it("serialises timestamps as ISO strings", () => {
    expect(toHousehold(household)).toMatchObject({
      createdAt: "2026-03-14T10:00:00.000Z",
      updatedAt: "2026-03-14T10:00:00.000Z",
    });
  });

  it("keeps unknown identity fields as null rather than dropping them", () => {
    // The contract declares them nullable, not optional.
    const unknown = { ...household, name: null, contact: null, religion: null };
    expect(toHousehold(unknown)).toMatchObject({ name: null, contact: null, religion: null });
  });
});

describe("toVisit", () => {
  it("nests the member who recorded it", () => {
    expect(toVisit(visit).member).toEqual({ id: "u1", name: "Alice", image: null });
  });

  it("is null for a visit made on no team", () => {
    expect(toVisit(visit).team).toBeNull();
  });

  it("carries the stamped team with its snapshot of teammates", () => {
    const team = { id: "t1", name: "Pair 1", members: [{ id: "u2", name: "Ben", image: null }] };
    expect(toVisit({ ...visit, teamId: "t1", team }).team).toEqual(team);
  });

  it("keeps client and server capture times apart", () => {
    const captured = new Date("2026-03-14T09:00:00.000Z");
    const serialised = toVisit({ ...visit, clientCreatedAt: captured });
    expect(serialised.clientCreatedAt).toBe("2026-03-14T09:00:00.000Z");
    expect(serialised.createdAt).toBe("2026-03-14T10:00:00.000Z");
  });

  it("names no follow-ups on an ordinary read", () => {
    expect(toVisit(visit)).not.toHaveProperty("followUpsMarkedDone");
  });
});

describe("toRecordedVisit", () => {
  it("is the visit, with the follow-ups recording it marked done", () => {
    expect(toRecordedVisit(visit, ["f1", "f2"])).toEqual({
      ...toVisit(visit),
      followUpsMarkedDone: ["f1", "f2"],
    });
  });
});

describe("toFollowUp", () => {
  it("names the door it belongs to", () => {
    expect(toFollowUp(followUp)).toMatchObject({ blockName: "123", unitNumber: "#05-123" });
  });

  it("nests author and resolver when resolved", () => {
    const serialised = toFollowUp(followUp);
    expect(serialised.author).toEqual({ id: "u1", name: "Alice", image: null });
    expect(serialised.doneBy).toEqual({ id: "u2", name: "Ben", image: null });
  });

  it("leaves doneBy null on an outstanding note", () => {
    const outstanding = {
      ...followUp,
      doneAt: null,
      doneById: null,
      doneByName: null,
      doneByImage: null,
    };
    const serialised = toFollowUp(outstanding);
    expect(serialised.doneBy).toBeNull();
    expect(serialised.doneAt).toBeNull();
  });

  it("allows a note with no due date", () => {
    expect(toFollowUp({ ...followUp, dueDate: null }).dueDate).toBeNull();
  });

  it("allows a note not tied to a particular visit", () => {
    expect(toFollowUp({ ...followUp, visitId: null }).visitId).toBeNull();
  });

  it("names the block and who put it on the list", () => {
    expect(toFollowUp(followUp)).toMatchObject({
      blockId: "b1",
      status: "listed",
      listedAt: "2026-03-14T10:00:00.000Z",
      listedBy: { id: "u3", name: "Admin", image: null },
    });
  });

  it("leaves the lister null on a suggestion", () => {
    const suggestion = {
      ...followUp,
      status: "suggested" as const,
      listedAt: null,
      listedById: null,
      listedByName: null,
      listedByImage: null,
    };
    expect(toFollowUp(suggestion)).toMatchObject({ listedAt: null, listedBy: null });
  });

  it("carries who removed it and why", () => {
    const removed = {
      ...followUp,
      deletedAt: at,
      deletedById: "u3",
      deletedByName: "Admin",
      deletedByImage: null,
      deleteReason: "Moved away",
    };
    expect(toFollowUp(removed)).toMatchObject({
      deletedAt: "2026-03-14T10:00:00.000Z",
      deletedBy: { id: "u3", name: "Admin", image: null },
      deleteReason: "Moved away",
    });
  });

  it("names who suggested the door while a suggestion waits there", () => {
    const waiting = {
      ...followUp,
      waitingSuggestionId: "f2",
      waitingById: "u2",
      waitingByName: "Ben",
      waitingByImage: null,
    };
    expect(toFollowUp(waiting).waitingSuggestionBy).toEqual({ id: "u2", name: "Ben", image: null });
    expect(toFollowUp(followUp).waitingSuggestionBy).toBeNull();
  });

  it("leaves the removal fields null on a live note", () => {
    expect(toFollowUp(followUp)).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    });
  });
});
