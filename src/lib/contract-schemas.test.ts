import { describe, expect, it } from "vitest";
import {
  zCreateVisitRequest,
  zHousehold,
  zInterestLevel,
  zReligion,
  zVisitSyncRequest,
} from "@/generated/zod.gen";

/*
 * Asserts what the contract actually enforces, by exercising the generated
 * validators rather than reading openapi.yaml. If the spec's intent and its
 * wording come apart, this is what notices - it already caught Household
 * declaring religion as a required non-nullable enum.
 */

const household = {
  id: "00000000-0000-4000-8000-000000000001",
  blockId: "00000000-0000-4000-8001-000000000001",
  unitNumber: "#05-123",
  name: "Mr Tan",
  contact: "+65 9123 4567",
  religion: "buddhist",
  createdAt: "2026-03-14T10:00:00Z",
  updatedAt: "2026-03-14T10:00:00Z",
};

describe("household identity is optional", () => {
  it("accepts a household nobody ever answered", () => {
    // The unit was knocked on, nobody replied, nothing is known. That has to
    // be representable or the record cannot be made at all.
    const result = zHousehold.safeParse({
      ...household,
      name: null,
      contact: null,
      religion: null,
    });
    expect(result.success).toBe(true);
  });

  it.each(["name", "contact", "religion"])("accepts a null %s", (field) => {
    expect(zHousehold.safeParse({ ...household, [field]: null }).success).toBe(true);
  });

  it("still requires a unit number", () => {
    // Everything else about a household may be unknown; which door it was is not.
    expect(zHousehold.safeParse({ ...household, unitNumber: null }).success).toBe(false);
    const { unitNumber: _omitted, ...withoutUnit } = household;
    expect(zHousehold.safeParse(withoutUnit).success).toBe(false);
  });

  it("rejects an empty unit number", () => {
    expect(zHousehold.safeParse({ ...household, unitNumber: "" }).success).toBe(false);
  });
});

describe("enums are closed", () => {
  it.each(["buddhist", "christian", "hindu", "freethinker", "others"])(
    "accepts religion %s",
    (value) => {
      expect(zReligion.safeParse(value).success).toBe(true);
    },
  );

  it("rejects a religion outside the set", () => {
    expect(zReligion.safeParse("jedi").success).toBe(false);
  });

  it.each(["low", "medium", "high", "no_response"])("accepts interest level %s", (value) => {
    expect(zInterestLevel.safeParse(value).success).toBe(true);
  });

  it("rejects an interest level outside the set", () => {
    expect(zInterestLevel.safeParse("none").success).toBe(false);
  });
});

describe("recording a visit", () => {
  const visit = {
    id: "01960000-0000-7000-8000-000000000001",
    blockId: "00000000-0000-4000-8001-000000000001",
    unitNumber: "#05-123",
    interestLevel: "no_response",
  };

  it("accepts the minimum a silent door produces", () => {
    // Two taps in the field: pick the unit, tap No Response.
    expect(zCreateVisitRequest.safeParse(visit).success).toBe(true);
  });

  it("requires a client-generated id", () => {
    const { id: _omitted, ...withoutId } = visit;
    expect(zCreateVisitRequest.safeParse(withoutId).success).toBe(false);
  });

  it("requires the id to be a uuid", () => {
    expect(zCreateVisitRequest.safeParse({ ...visit, id: "not-a-uuid" }).success).toBe(false);
  });

  it("requires an interest level", () => {
    const { interestLevel: _omitted, ...withoutLevel } = visit;
    expect(zCreateVisitRequest.safeParse(withoutLevel).success).toBe(false);
  });

  it("rejects a description beyond the documented limit", () => {
    expect(zCreateVisitRequest.safeParse({ ...visit, description: "x".repeat(4001) }).success).toBe(
      false,
    );
  });
});

describe("offline sync batches", () => {
  const item = {
    id: "01960000-0000-7000-8000-000000000001",
    blockId: "00000000-0000-4000-8001-000000000001",
    unitNumber: "#05-123",
    interestLevel: "low" as const,
    clientCreatedAt: "2026-03-14T10:00:00Z",
    updatedAt: "2026-03-14T10:00:00Z",
  };

  const sentAt = "2026-03-14T12:00:00Z";

  it("accepts a batch of queued records", () => {
    expect(zVisitSyncRequest.safeParse({ sentAt, items: [item, item] }).success).toBe(true);
  });

  it("requires sentAt, the phone's clock at send time", () => {
    expect(zVisitSyncRequest.safeParse({ items: [item] }).success).toBe(false);
  });

  it("rejects a sentAt that is not a timestamp", () => {
    expect(zVisitSyncRequest.safeParse({ sentAt: "soon", items: [item] }).success).toBe(false);
  });

  it("rejects an empty batch", () => {
    expect(zVisitSyncRequest.safeParse({ sentAt, items: [] }).success).toBe(false);
  });

  it("rejects a batch beyond the documented limit", () => {
    // Bounded so one client cannot flush an unbounded queue in a single request.
    const items = Array.from({ length: 101 }, () => item);
    expect(zVisitSyncRequest.safeParse({ sentAt, items }).success).toBe(false);
  });

  it("requires updatedAt, which decides last-write-wins", () => {
    const { updatedAt: _omitted, ...withoutUpdatedAt } = item;
    expect(zVisitSyncRequest.safeParse({ items: [withoutUpdatedAt] }).success).toBe(false);
  });
});
