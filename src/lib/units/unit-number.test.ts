import { describe, expect, it } from "vitest";
import { nextUnitNumber, normaliseUnitNumber, parseUnitNumber } from "@/lib/units/unit-number";

describe("nextUnitNumber", () => {
  it("advances along a corridor", () => {
    expect(nextUnitNumber("#05-123")).toBe("#05-124");
  });

  it("keeps the unit width, so #12-07 becomes #12-08 not #12-8", () => {
    expect(nextUnitNumber("#12-07")).toBe("#12-08");
  });

  it("carries into a wider number when it has to", () => {
    expect(nextUnitNumber("#03-09")).toBe("#03-10");
  });

  it("accepts a unit typed without the hash", () => {
    expect(nextUnitNumber("05-123")).toBe("#05-124");
  });

  it("tolerates spaces around the dash", () => {
    expect(nextUnitNumber("#05 - 123")).toBe("#05-124");
  });

  it.each(["", "Penthouse", "#05", "Blk 123", "05/123", "#ab-cd", "#1-2-3", "#05-"])(
    "returns null for %s rather than guessing",
    (value) => {
      /*
       * A wrong suggestion is worse than none - it would be accepted without
       * thought and record the wrong door.
       */
      expect(nextUnitNumber(value)).toBeNull();
    },
  );
});

describe("normaliseUnitNumber", () => {
  it("adds the hash and strips spacing", () => {
    expect(normaliseUnitNumber("  05 - 123 ")).toBe("#05-123");
  });

  it("leaves an already-normal unit alone", () => {
    expect(normaliseUnitNumber("#05-123")).toBe("#05-123");
  });

  it("passes through something it does not recognise, only trimmed", () => {
    // Not every block numbers its doors the same way.
    expect(normaliseUnitNumber("  Penthouse  ")).toBe("Penthouse");
  });
});

describe("parseUnitNumber", () => {
  it("splits floor from unit", () => {
    expect(parseUnitNumber("#05-123")).toEqual({ floor: "05", unit: "123", unitWidth: 3 });
  });

  it("returns null for an unrecognised format", () => {
    expect(parseUnitNumber("Penthouse")).toBeNull();
  });
});
