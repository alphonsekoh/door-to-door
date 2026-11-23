import { describe, expect, it } from "vitest";
import { formatDay } from "@/lib/history/dates";
import {
  POLICY_SECTIONS,
  POLICY_SECTION_IDS,
  POLICY_UPDATED,
  RESPONSE_TIMES,
  RESTORE_WINDOW_HOURS,
  RETENTION,
  hours,
} from "@/lib/privacy/policy";

describe("the policy's facts", () => {
  it("has a section for each PDPA obligation, in the order the text reads", () => {
    expect(POLICY_SECTIONS.map(({ id }) => id)).toEqual([
      "who",
      "collected",
      "purposes",
      "consent",
      "access",
      "erasure",
      "retention",
      "protection",
      "transfers",
      "breach",
      "dnc",
      "contact",
      "changes",
    ]);
    expect(POLICY_SECTIONS.map(({ id }) => id)).toEqual([...POLICY_SECTION_IDS]);
  });

  it("is last updated on a real day", () => {
    expect(Number.isNaN(new Date(POLICY_UPDATED).getTime())).toBe(false);
    expect(formatDay(POLICY_UPDATED)).toBe("23 Nov 2026");
  });

  it("states the owner's retention periods", () => {
    const keep = (id: string) => RETENTION.find((row) => row.id === id)?.keep;
    expect(keep("households")).toContain("24 months after the last visit or follow-up activity");
    expect(keep("accounts")).toContain("12 months");
    expect(keep("sign-ins")).toBe("30 days after the sign-in was last used");
    expect(RETENTION.find((row) => row.id === "households")?.what).toContain("follow-up notes");
  });

  it("quotes the response times", () => {
    expect(RESPONSE_TIMES.access).toBe("30 days");
    expect(RESPONSE_TIMES.breachReport).toBe("3 calendar days");
  });

  it("holds Neon's restore window as a positive whole number of hours", () => {
    expect(Number.isInteger(RESTORE_WINDOW_HOURS)).toBe(true);
    expect(RESTORE_WINDOW_HOURS).toBeGreaterThan(0);
  });

  it("writes a count of hours in the singular and the plural", () => {
    expect(hours(1)).toBe("1 hour");
    expect(hours(6)).toBe("6 hours");
  });
});
