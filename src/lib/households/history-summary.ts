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
 * The longest the line can say, which it is held to from the moment the
 * typed unit matches one of the block's: all four parts, with two figures of visits. In tabular figures
 * every two-figure count is as wide, so only a unit knocked at a hundred
 * times outgrows it, by a figure. Held much wider, it took two rows where
 * the words take one: at the default 17px, a 375pt iPhone has 6px to spare.
 */
export const LONGEST_SUMMARY = [ON_THE_LIST, OVERDUE, visitCount(99), SEE_HISTORY].join(" · ");

export type HistoryLine =
  { kind: "read"; summary: HistorySummary } | { kind: "reading" } | { kind: "unread" };

export type TypedUnit = {
  /* A household at this unit is among the block's units read. */
  matched: boolean;
  /* Its history, once read. */
  history: Pick<HouseholdHistory, "followUps" | "pagination"> | null;
  /* Its history could not be read. */
  unread: boolean;
};

/*
 * Only a unit among the block's units read has a line: there is a history
 * to read. Any other says nothing and keeps no room (owner, 2026-11-18): a
 * held row at every new door put Low, Medium and High under the docked Save
 * after Save and next on an iPhone at its default text.
 */
export function historyLine(unit: TypedUnit, now: Date): HistoryLine | null {
  if (!unit.matched) return null;
  if (unit.history !== null) return { kind: "read", summary: historySummary(unit.history, now) };
  return { kind: unit.unread ? "unread" : "reading" };
}
