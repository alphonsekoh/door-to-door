import type { OutingSession, SessionHousehold } from "@/generated/types.gen";

/*
 * A follow-up session's picked households, as its admin page shows them:
 * where each stands, and whether it may still be taken out.
 */

export type PickState = "to_visit" | "visited" | "done" | "done_before" | "off_list";

/*
 * The server says whether a pick is on the list now. Off it, a pick has no
 * listed notes left (they were taken off the follow-up list), or every one
 * was resolved before the session started, which for a draft is any time.
 */
export function householdState(entry: SessionHousehold): PickState {
  if (!entry.onList) return entry.notes.length === 0 ? "off_list" : "done_before";
  if (entry.notes.every((note) => note.doneAt !== null)) return "done";
  return entry.visitedInSession ? "visited" : "to_visit";
}

export function stateLabel(state: PickState, status: OutingSession["status"]): string | null {
  switch (state) {
    case "to_visit":
      return null;
    case "visited":
      return "Visited";
    case "done":
      return "Done";
    case "done_before":
      return status === "draft" ? "Already done" : "Done before it started";
    case "off_list":
      return "Off the follow-up list";
  }
}

export type RemoveBlocker = "ended" | "visited" | "last";

/* Why a pick cannot be taken out, as the server would refuse it, or null. */
export function removeBlocker(
  entry: SessionHousehold,
  entries: readonly SessionHousehold[],
  status: OutingSession["status"],
): RemoveBlocker | null {
  if (status === "ended") return "ended";
  if (entry.visitedInSession) return "visited";
  if (entries.length <= 1) return "last";
  return null;
}

export const REMOVE_BLOCKED: Record<Exclude<RemoveBlocker, "ended">, string> = {
  visited: "Visited in this session, so it stays.",
  last: "A follow-up session needs at least one household, so the last one can't be removed.",
};
