import { describe, expect, it } from "vitest";
import { formatDay } from "@/lib/history/dates";
import { LOCAL_COPY_TTL_MS } from "@/lib/offline/local-copy";
import { SYNCED_KEPT_MS } from "@/lib/sync/controller";
import { UNSENT_KEPT_MS } from "@/lib/sync/purge-on-start";
import { SESSION_MAX_AGE_SECONDS } from "@/server/auth/lifetime";
import {
  ERASE_WITHIN_WEEKDAYS,
  LOCAL_COPY_HOURS,
  POLICY_SECTIONS,
  POLICY_SECTION_IDS,
  POLICY_UPDATED,
  RESPONSE_TIMES,
  RESTORE_WINDOW_HOURS,
  RETENTION,
  RETENTION_PERIODS,
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
    expect(formatDay(POLICY_UPDATED)).toBe("25 Nov 2026");
  });

  it("states the owner's retention periods", () => {
    const keep = (id: string) => RETENTION.find((row) => row.id === id)?.keep;
    expect(keep("households")).toContain("24 months after the last visit or follow-up activity");
    expect(keep("accounts")).toContain("12 months");
    expect(keep("sign-ins")).toBe("30 days after the sign-in was last used");
    expect(RETENTION.find((row) => row.id === "households")?.what).toContain("follow-up notes");
    // The phone's copy holds each listed unit's earlier visits (#275).
    expect(keep("phones")).toContain(
      "the session's units, with their earlier visits, for 12 hours or until sign-out",
    );
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

describe("the periods the code applies (#279)", () => {
  it("are the ones the policy states", () => {
    expect(RETENTION_PERIODS).toEqual({
      householdMonths: 24,
      accountMonths: 12,
      signInDays: 30,
      unsentRecordDays: 30,
    });
    const keep = (id: string) => RETENTION.find((row) => row.id === id)?.keep ?? "";
    expect(keep("households")).toContain(`${String(RETENTION_PERIODS.householdMonths)} months`);
    expect(keep("accounts")).toContain(`${String(RETENTION_PERIODS.accountMonths)} months`);
    expect(keep("requests")).toContain(`${String(RETENTION_PERIODS.accountMonths)} months`);
    expect(keep("sign-ins")).toContain(`${String(RETENTION_PERIODS.signInDays)} days`);
    expect(keep("phones")).toContain(`${String(RETENTION_PERIODS.unsentRecordDays)} days at most`);
  });

  it("match what the phone and the server count in", () => {
    expect(RETENTION_PERIODS.signInDays * 86_400).toBe(SESSION_MAX_AGE_SECONDS);
    expect(RETENTION_PERIODS.unsentRecordDays * 86_400_000).toBe(UNSENT_KEPT_MS);
    expect(SYNCED_KEPT_MS).toBe(24 * 3_600_000);
    expect(LOCAL_COPY_HOURS * 3_600_000).toBe(LOCAL_COPY_TTL_MS);
    expect(keepOf("phones")).toContain("24 hours");
    expect(keepOf("phones")).toContain(`${String(LOCAL_COPY_HOURS)} hours`);
  });

  it("lists what is kept of an erasure, and the sign-up requests that are erased", () => {
    expect(RETENTION.map((row) => row.id)).toEqual(
      expect.arrayContaining(["requests", "erasures", "phones"]),
    );
    expect(keepOf("erasures")).toContain("no personal data");
  });

  it("allows ten weekdays to act on a request", () => {
    expect(ERASE_WITHIN_WEEKDAYS).toBe(10);
  });
});

function keepOf(id: string): string {
  return RETENTION.find((row) => row.id === id)?.keep ?? "";
}
