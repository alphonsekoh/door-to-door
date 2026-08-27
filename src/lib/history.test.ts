import { describe, expect, it } from "vitest";
import { interestSegments, isSameDay, totalRecorded } from "@/lib/history";

const breakdown = (low = 0, medium = 0, high = 0, noResponse = 0) => ({
  low,
  medium,
  high,
  noResponse,
});

describe("interestSegments", () => {
  it("orders the outcomes best first", () => {
    expect(interestSegments(breakdown(1, 2, 3, 4)).map((s) => s.label)).toEqual([
      "High",
      "Medium",
      "Low",
      "No answer",
    ]);
  });

  it("drops the outcomes that did not happen", () => {
    // "High 0 · Medium 0" is noise on a phone; what happened should be legible.
    expect(interestSegments(breakdown(0, 0, 2, 5)).map((s) => s.label)).toEqual([
      "High",
      "No answer",
    ]);
  });

  it("carries the count and the level with each label", () => {
    expect(interestSegments(breakdown(0, 0, 0, 7))).toEqual([
      { level: "no_response", label: "No answer", count: 7 },
    ]);
  });

  it("returns nothing for an outing with no records", () => {
    expect(interestSegments(breakdown())).toEqual([]);
  });
});

describe("totalRecorded", () => {
  it("counts no-response alongside the rest", () => {
    // A block of silent doors is still a full evening's work.
    expect(totalRecorded(breakdown(1, 2, 3, 4))).toBe(10);
  });

  it("is zero for an empty breakdown", () => {
    expect(totalRecorded(breakdown())).toBe(0);
  });
});

describe("isSameDay", () => {
  it("is true for two instants on the same day", () => {
    // Built in local time on purpose: the comparison is the reader's day, and
    // fixed UTC strings would flip either side of the date line.
    const morning = new Date(2026, 2, 14, 9).toISOString();
    const evening = new Date(2026, 2, 14, 21).toISOString();
    expect(isSameDay(morning, evening)).toBe(true);
  });

  it("is false across a day boundary", () => {
    const first = new Date(2026, 2, 14, 12).toISOString();
    const second = new Date(2026, 2, 15, 12).toISOString();
    expect(isSameDay(first, second)).toBe(false);
  });

  it("is false across a month, and across a year", () => {
    const march = new Date(2026, 2, 14, 12).toISOString();
    const april = new Date(2026, 3, 14, 12).toISOString();
    const nextYear = new Date(2027, 2, 14, 12).toISOString();
    expect(isSameDay(march, april)).toBe(false);
    expect(isSameDay(march, nextYear)).toBe(false);
  });
});
