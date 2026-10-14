import type {
  HistoryEntry,
  HouseholdSummary,
  InterestBreakdown,
  InterestLevel,
} from "@/generated/types.gen";

/*
 * Shaping a member's own history for reading.
 *
 * Date formatting stays in the components, where toLocaleDateString gives the
 * member their own locale and zone. What lives here is the arithmetic, which
 * has to be right regardless of where the phone is.
 */

export type InterestSegment = { level: InterestLevel; label: string; count: number };

const ORDER: { level: InterestLevel; label: string; key: keyof InterestBreakdown }[] = [
  { level: "high", label: "High", key: "high" },
  { level: "medium", label: "Medium", key: "medium" },
  { level: "low", label: "Low", key: "low" },
  { level: "no_response", label: "No answer", key: "noResponse" },
];

/*
 * Best outcome first, and zeroes dropped. A row of "High 0 · Medium 0 · Low 0"
 * is noise on a phone, and hiding it makes the outcomes that did happen legible
 * at a glance.
 */
export function interestSegments(interest: InterestBreakdown): InterestSegment[] {
  return ORDER.filter((entry) => interest[entry.key] > 0).map((entry) => ({
    level: entry.level,
    label: entry.label,
    count: interest[entry.key],
  }));
}

export function totalRecorded(interest: InterestBreakdown): number {
  return interest.high + interest.medium + interest.low + interest.noResponse;
}

/* Compared in the reader's own zone, which is the one the dates are shown in. */
export function isSameDay(a: string, b: string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/*
 * The amend sheet patches "the household's latest visit", and from a history
 * row the record in hand is that visit - so it is handed the same shape the
 * block list gives it rather than growing a second way in.
 */
export function asHouseholdSummary(entry: HistoryEntry): HouseholdSummary {
  return {
    household: entry.household,
    visitCount: 1,
    latestVisit: entry.visit,
    outstandingFollowUps: 0,
  };
}
