import { describe, expect, it } from "vitest";
import { matchesHouseholdSearch } from "@/lib/households/search";

const door = (
  unitNumber: string,
  name: string | null = null,
  contact: string | null = null,
): { unitNumber: string; name: string | null; contact: string | null } => ({
  unitNumber,
  name,
  contact,
});

describe("matchesHouseholdSearch", () => {
  it.each(["", "   "])("matches every door on an empty term (%j)", (q) => {
    expect(matchesHouseholdSearch(door("#05-12"), q)).toBe(true);
  });

  it("matches the unit as typed", () => {
    expect(matchesHouseholdSearch(door("#05-12"), "#05-12")).toBe(true);
    expect(matchesHouseholdSearch(door("#05-12"), "05-1")).toBe(true);
  });

  it("matches the unit typed without its # and -", () => {
    // On a phone keypad the punctuation is a second screen away.
    expect(matchesHouseholdSearch(door("#05-12"), "0512")).toBe(true);
  });

  it("matches the name in any case", () => {
    expect(matchesHouseholdSearch(door("#05-12", "Mr Tan"), "mr TAN")).toBe(true);
  });

  it("matches the contact", () => {
    expect(matchesHouseholdSearch(door("#05-12", null, "91234567"), "1234")).toBe(true);
  });

  it("trims the term", () => {
    expect(matchesHouseholdSearch(door("#05-12", "Mr Tan"), "  tan  ")).toBe(true);
  });

  it("never matches a missing name or contact as the word null", () => {
    expect(matchesHouseholdSearch(door("#05-12"), "null")).toBe(false);
  });

  it("does not match an unrelated term", () => {
    expect(matchesHouseholdSearch(door("#05-12", "Mr Tan", "91234567"), "lim")).toBe(false);
  });
});
