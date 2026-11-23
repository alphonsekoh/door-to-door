import { describe, expect, it } from "vitest";
import { formatDay } from "@/lib/history/dates";
import {
  POLICY_SECTIONS,
  POLICY_SECTION_IDS,
  POLICY_UPDATED,
  RESPONSE_TIMES,
  RESTORE_WINDOW_DAYS,
  RETENTION,
  days,
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

  it("is last updated on a real day that is not in the future", () => {
    expect(Number.isNaN(new Date(POLICY_UPDATED).getTime())).toBe(false);
    expect(new Date(POLICY_UPDATED).getTime()).toBeLessThanOrEqual(Date.now());
    expect(formatDay(POLICY_UPDATED)).toBe("23 Nov 2026");
  });

  it("states the owner's retention periods", () => {
    const keep = (id: string) => RETENTION.find((row) => row.id === id)?.keep;
    expect(keep("households")).toContain("24 months after the last visit or follow-up activity");
    expect(keep("accounts")).toContain("12 months");
    expect(keep("sign-ins")).toContain("30 days");
  });

  it("quotes the response times", () => {
    expect(RESPONSE_TIMES.access).toBe("30 days");
    expect(RESPONSE_TIMES.breachReport).toBe("3 calendar days");
  });

  it("holds Neon's restore window as a positive whole number of days", () => {
    expect(Number.isInteger(RESTORE_WINDOW_DAYS)).toBe(true);
    expect(RESTORE_WINDOW_DAYS).toBeGreaterThan(0);
  });

  it("writes a count of days in the singular and the plural", () => {
    expect(days(1)).toBe("1 day");
    expect(days(7)).toBe("7 days");
  });
});
