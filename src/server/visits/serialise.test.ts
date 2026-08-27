import { describe, expect, it } from "vitest";
import type { FollowUpRow } from "@/server/visits/queries";
import { toFollowUp, toHousehold, toVisit } from "@/server/visits/serialise";
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
  visitId: "v1",
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

  it("keeps client and server capture times apart", () => {
    const captured = new Date("2026-03-14T09:00:00.000Z");
    const serialised = toVisit({ ...visit, clientCreatedAt: captured });
    expect(serialised.clientCreatedAt).toBe("2026-03-14T09:00:00.000Z");
    expect(serialised.createdAt).toBe("2026-03-14T10:00:00.000Z");
  });
});

describe("toFollowUp", () => {
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
});
