import { describe, expect, it } from "vitest";
import { loadOpenApiDocument } from "@/lib/openapi-document";
import {
  MAX_UNIT_NUMBER_LENGTH,
  nextUnitNumber,
  normaliseUnitNumber,
  parseUnitNumber,
  unitNumberFault,
} from "@/lib/units/unit-number";

type Property = { maxLength?: number };
type Part = { properties?: Record<string, Property> };

/* A request schema's unitNumber, wherever in its allOf it is declared. */
function unitNumberIn(schema: string): Property | undefined {
  const { allOf } = loadOpenApiDocument().components.schemas[schema] as { allOf: Part[] };
  return allOf.find((part) => part.properties?.["unitNumber"] !== undefined)?.properties?.[
    "unitNumber"
  ];
}

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

describe("MAX_UNIT_NUMBER_LENGTH", () => {
  // The forms' copy says this number, so it must be the one the server holds.
  it.each(["CreateVisitRequest", "VisitSyncItem"])(
    "is %s's unitNumber.maxLength in openapi.yaml",
    (schema) => {
      expect(unitNumberIn(schema)?.maxLength).toBe(MAX_UNIT_NUMBER_LENGTH);
    },
  );
});

describe("unitNumberFault", () => {
  it("calls a unit of only spaces blank", () => {
    expect(unitNumberFault("")).toBe("blank");
    expect(unitNumberFault("   ")).toBe("blank");
  });

  it("takes a unit of exactly 32 characters, spaces around it not counted", () => {
    expect(unitNumberFault(`  ${"#".padEnd(32, "1")}  `)).toBeNull();
  });

  it("refuses one character more", () => {
    expect(unitNumberFault("#".padEnd(33, "1"))).toBe("too_long");
  });

  it("judges the unit as it is sent, once normalised", () => {
    // 34 typed, but "#05-" and 28 digits once the spaces round the dash go.
    expect(unitNumberFault(`#05 - ${"1".repeat(28)}`)).toBeNull();
    // 32 typed, but the hash the household key adds makes 33.
    expect(unitNumberFault(`05-${"1".repeat(29)}`)).toBe("too_long");
  });

  it("finds nothing wrong with an ordinary unit", () => {
    expect(unitNumberFault("#05-123")).toBeNull();
  });
});
