import type { HouseholdHistory } from "@/generated/types.gen";
import { ON_THE_LIST } from "@/lib/follow-ups/rights";
import { isOverdue } from "@/lib/history/follow-ups";

/*
 * One line under the unit field that says what the unit's history holds, so
 * its key facts are seen before knocking even where the history itself is
 * below Save (#196): the history panel is last in the form, where its
 * landing moves nothing a member taps.
 */

/* The panel's own heading for a suggestion an admin has yet to decide. */
export const WAITING_FOR_REVIEW = "Waiting for review";
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

export function visitCount(total: number): string {
  if (total === 0) return "No visits yet";
  return total === 1 ? "1 visit" : `${String(total)} visits`;
}

export function historySummary(
  history: Pick<HouseholdHistory, "followUps" | "pagination">,
  now: Date,
): HistorySummary {
  const owed = history.followUps.filter((note) => note.status === "listed" && note.doneAt === null);
  const waiting = history.followUps.some((note) => note.status === "suggested");
  return {
    followUp: owed.length > 0 ? ON_THE_LIST : waiting ? WAITING_FOR_REVIEW : null,
    overdue: owed.some((note) => isOverdue(note, now)),
    visits: visitCount(history.pagination.total),
  };
}

/*
 * The longest the line can say, which it is held to from the moment a unit
 * is typed: all four parts, with the visit count at its widest.
 */
export const LONGEST_SUMMARY = [ON_THE_LIST, OVERDUE, visitCount(0), SEE_HISTORY].join(" · ");

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
