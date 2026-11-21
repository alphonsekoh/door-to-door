import { describe, expect, it } from "vitest";
import { untouchableDatabase } from "@/db/testing";
import { ValidationError } from "@/server/http/errors";
import { createVisit, foldHouseholds, upsertHousehold } from "@/server/visits/service";

const untouchable = untouchableDatabase();

const clock = { now: new Date("2026-03-14T12:00:00.000Z"), toleranceMs: 300_000 };
const blank = { path: "/unitNumber", message: "Must contain something other than spaces." };

describe("a blank unit number", () => {
  it("is refused by createVisit before anything is read", async () => {
    const recording = createVisit(
      untouchable,
      {
        id: "01960000-0000-7000-8000-000000000001",
        blockId: "b1",
        unitNumber: " 　 ",
        interestLevel: "low",
        memberId: "u1",
        // In the future too: the unit is judged before the clock.
        clientCreatedAt: "2099-01-01T00:00:00.000Z",
      },
      clock,
      { role: "admin" },
    );
    await expect(recording).rejects.toBeInstanceOf(ValidationError);
    await expect(recording).rejects.toMatchObject({ details: [blank] });
  });

  it("is refused by upsertHousehold for any other caller", async () => {
    await expect(
      upsertHousehold(untouchable, { blockId: "b1", unitNumber: "   " }),
    ).rejects.toMatchObject({ code: "validation_failed", details: [blank] });
  });
});

describe("folding a batch's units into one row each", () => {
  const BLOCK = "0b0b0b0b-0000-4000-8001-000000000001";
  const LATER_BLOCK = "0b0b0b0b-0000-4000-8001-000000000002";
  const at = (unitNumber: string, blockId = BLOCK) => ({ blockId, unitNumber });

  it("lets a later known value win, field by field, in request order", () => {
    expect(
      foldHouseholds([
        { ...at("#01-01"), name: "Mr Tan", contact: "9123 4567" },
        { ...at("#01-01"), name: "Mrs Tan", religion: "buddhist" },
        { ...at("#01-01"), contact: "8123 4567" },
      ]),
    ).toEqual([{ ...at("#01-01"), name: "Mrs Tan", contact: "8123 4567", religion: "buddhist" }]);
  });

  it("never lets a blank or a null erase what an earlier record learnt", () => {
    expect(
      foldHouseholds([
        { ...at("#01-01"), name: " Mr Tan ", contact: "9123 4567", religion: "hindu" },
        { ...at("#01-01"), name: "  ", contact: null, religion: null },
      ]),
    ).toEqual([{ ...at("#01-01"), name: "Mr Tan", contact: "9123 4567", religion: "hindu" }]);
  });

  it("names no identity field for a unit nothing was learnt at", () => {
    expect(foldHouseholds([{ ...at("#01-01"), name: "" }, at("#01-01")])).toEqual([at("#01-01")]);
  });

  it("takes a block in either letter case as one, written in lower case", () => {
    expect(
      foldHouseholds([
        { ...at("#01-01", BLOCK.toUpperCase()), name: "Mr Tan" },
        { ...at("#01-01"), contact: "9123 4567" },
      ]),
    ).toEqual([{ ...at("#01-01"), name: "Mr Tan", contact: "9123 4567" }]);
  });

  it("orders the rows by block, then unit, whatever order they came in", () => {
    expect(
      foldHouseholds([
        at("#02-01", LATER_BLOCK),
        at("#02-01"),
        at("#01-01", LATER_BLOCK),
        at("#10-01"),
        at("#01-01"),
      ]),
    ).toEqual([
      at("#01-01"),
      at("#02-01"),
      at("#10-01"),
      at("#01-01", LATER_BLOCK),
      at("#02-01", LATER_BLOCK),
    ]);
  });
});
