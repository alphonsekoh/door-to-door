import { describe, expect, it } from "vitest";
import type { FollowUp } from "@/generated/types.gen";
import {
  LONGEST_SUMMARY,
  type TypedUnit,
  historyLine,
  historySummary,
  visitCount,
} from "@/lib/households/history-summary";

/* Local-time constructors, so these hold in any time zone. */
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const NOW = local(2026, 11, 18);

function note(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "f1",
    householdId: "h1",
    blockId: "b1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    status: "listed",
    author: { id: "u1", name: "Alice Tan", image: null },
    note: "Bring the flyer.",
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-03-03T04:00:00.000Z",
    ...overrides,
  };
}

const unit = (followUps: FollowUp[], total = 3) => ({
  followUps,
  pagination: { limit: 20, offset: 0, total, hasMore: false },
});

const yesterday = local(2026, 11, 17).toISOString();
const today = local(2026, 11, 18).toISOString();

describe("historySummary", () => {
  it("says a unit owes a note on the list, and that it is overdue once its day has passed", () => {
    expect(historySummary(unit([note({ dueDate: yesterday })]), NOW)).toEqual({
      followUp: "On the follow-up list",
      overdue: true,
      visits: "3 visits",
    });
  });

  it("calls a note due today, or with no day, owed but not overdue", () => {
    for (const dueDate of [today, null]) {
      expect(historySummary(unit([note({ dueDate })]), NOW)).toMatchObject({
        followUp: "On the follow-up list",
        overdue: false,
      });
    }
  });

  it("is overdue when any owed note is, whichever comes first", () => {
    const later = note({ id: "f2", dueDate: local(2026, 12, 1).toISOString() });
    expect(historySummary(unit([later, note({ dueDate: yesterday })]), NOW).overdue).toBe(true);
  });

  it("counts a note marked done as owed no longer, overdue or not", () => {
    const done = note({ dueDate: yesterday, doneAt: today });
    expect(historySummary(unit([done]), NOW)).toEqual({
      followUp: null,
      overdue: false,
      visits: "3 visits",
    });
  });

  it("says a suggestion waits for review only where nothing is owed on the list", () => {
    const waiting = note({ id: "f2", status: "suggested", dueDate: yesterday });
    expect(historySummary(unit([waiting]), NOW)).toEqual({
      followUp: "Waiting for review",
      overdue: false,
      visits: "3 visits",
    });
    expect(historySummary(unit([waiting, note()]), NOW).followUp).toBe("On the follow-up list");
    const done = note({ doneAt: today });
    expect(historySummary(unit([done, waiting]), NOW).followUp).toBe("Waiting for review");
  });

  it("says nothing of the list for a unit with no notes", () => {
    expect(historySummary(unit([]), NOW).followUp).toBeNull();
  });
});

describe("visitCount", () => {
  it("counts every visit at the unit, on every page", () => {
    expect(visitCount(1)).toBe("1 visit");
    expect(visitCount(2)).toBe("2 visits");
    expect(visitCount(41)).toBe("41 visits");
  });

  it("reads the count from the whole history, not the page read", () => {
    expect(historySummary(unit([], 41), NOW).visits).toBe("41 visits");
  });
});

describe("LONGEST_SUMMARY", () => {
  it("is every part at its longest, two figures of visits, in the order the line says them", () => {
    expect(LONGEST_SUMMARY).toBe("On the follow-up list · Overdue · 99 visits · See history");
  });
});

describe("historyLine", () => {
  const typed = (over: Partial<TypedUnit> = {}): TypedUnit => ({
    matched: true,
    history: null,
    unread: false,
    ...over,
  });

  it("sums up a history once read", () => {
    expect(historyLine(typed({ history: unit([]) }), NOW)).toEqual({
      kind: "read",
      summary: { followUp: null, overdue: false, visits: "3 visits" },
    });
  });

  it("says it is reading a known unit's history until it lands, or fails to", () => {
    expect(historyLine(typed(), NOW)).toEqual({ kind: "reading" });
    expect(historyLine(typed({ unread: true }), NOW)).toEqual({ kind: "unread" });
  });

  /* Never recorded, not among the units read yet, or held only on this
     phone: no line, and no room kept for one (owner, 2026-11-18). */
  it("has no line for a unit that is not among the block's units read", () => {
    expect(historyLine(typed({ matched: false }), NOW)).toBeNull();
  });
});
