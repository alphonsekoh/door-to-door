import type { HouseholdHistory } from "@/generated/types.gen";
import { ON_THE_LIST, WAITING_FOR_REVIEW, awaitsReview, isOwed } from "@/lib/follow-ups/rights";
import { isOverdue } from "@/lib/history/follow-ups";

/*
 * One line under the unit field that says what the unit's history holds, so
 * its key facts are seen before knocking even where the history itself is
 * below Save (#196): the history panel is last in the form, where its
 * landing moves nothing a member taps.
 */

export const OVERDUE = "Overdue";
export const SEE_HISTORY = "See history";
export const NO_EARLIER_VISITS = "No earlier visits";
export const READING_HISTORY = "Checking this unit's history…";
export const HISTORY_UNREAD = "Could not read this unit's history.";

export type HistorySummary = {
  /* Where the unit stands with the follow-up list, by the panel's rules:
     a listed note still owed, or else a suggestion waiting. */
  followUp: typeof ON_THE_LIST | typeof WAITING_FOR_REVIEW | null;
  /* Some owed note is past its due day. */
  overdue: boolean;
  visits: string;
};

/* Never none: a household is made by its first visit, and no visit is
   deleted. */
export function visitCount(total: number): string {
  return total === 1 ? "1 visit" : `${String(total)} visits`;
}

export function historySummary(
  history: Pick<HouseholdHistory, "followUps" | "pagination">,
  now: Date,
): HistorySummary {
  const owed = history.followUps.filter(isOwed);
  const waiting = history.followUps.some(awaitsReview);
  return {
    followUp: owed.length > 0 ? ON_THE_LIST : waiting ? WAITING_FOR_REVIEW : null,
    overdue: owed.some((note) => isOverdue(note, now)),
    visits: visitCount(history.pagination.total),
  };
}

/*
 * The longest the line can say, which it is held to from the moment a unit
 * is typed: all four parts, with two figures of visits. In tabular figures
 * every two-figure count is as wide, so only a unit knocked at a hundred
 * times outgrows it, by a figure. Held much wider, it took two rows where
 * the words take one: at the default 17px, a 375pt iPhone has 6px to spare.
 */
export const LONGEST_SUMMARY = [ON_THE_LIST, OVERDUE, visitCount(99), SEE_HISTORY].join(" · ");

export type HistoryLine =
  | { kind: "read"; summary: HistorySummary }
  | { kind: "reading" }
  | { kind: "unread" }
  /* The block's units were all read, and none is this one. */
  | { kind: "no_household" }
  /* Nothing can be said yet, or nothing true: the block's units are still
     being read or could not all be, or a visit to it waits on this phone. */
  | { kind: "blank" };

export type TypedUnit = {
  /* Its history, once read. */
  history: Pick<HouseholdHistory, "followUps" | "pagination"> | null;
  /* A household at this unit is among the block's units read. */
  matched: boolean;
  /* Its history could not be read. */
  unread: boolean;
  /* Every unit of the block has been read. */
  unitsRead: boolean;
  /* A visit to it is held on this phone, which the block's units may not
     show yet. */
  onPhone: boolean;
};

export function historyLine(unit: TypedUnit, now: Date): HistoryLine {
  if (unit.history !== null) return { kind: "read", summary: historySummary(unit.history, now) };
  if (unit.matched) return { kind: unit.unread ? "unread" : "reading" };
  return unit.unitsRead && !unit.onPhone ? { kind: "no_household" } : { kind: "blank" };
}
