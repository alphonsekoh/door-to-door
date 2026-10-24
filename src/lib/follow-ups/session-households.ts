import type {
  FollowUp,
  OutingSession,
  SessionBlock,
  SessionHousehold,
} from "@/generated/types.gen";

/*
 * A follow-up session's picked households, as its admin page shows them:
 * where each stands, and whether it may still be taken out.
 */

export type PickState = "to_visit" | "visited" | "done" | "done_before" | "off_list";

/*
 * The server says whether a pick is on the list now. Off it, either a note
 * owed when it was picked was resolved before the session started (for a
 * draft, at any time since), or the notes it was picked for were taken off
 * the follow-up list. A note resolved before the pick was never what it was
 * picked for, so it says nothing about which.
 */
export function householdState(entry: SessionHousehold): PickState {
  if (!entry.onList) {
    const picked = Date.parse(entry.addedAt);
    const resolvedSince = entry.notes.some(
      (note) => note.doneAt !== null && Date.parse(note.doneAt) >= picked,
    );
    return resolvedSince ? "done_before" : "off_list";
  }
  if (entry.notes.every((note) => note.doneAt !== null)) return "done";
  return entry.visitedInSession ? "visited" : "to_visit";
}

/*
 * The note a pick was made for, as its row says it: the first still owed
 * (the soonest due, as the picker showed it), else the one resolved most
 * recently since the pick or the session's start, whichever came first.
 * The server orders owed notes first and then the newest resolved, so it is
 * the first that qualifies. A note resolved before both was never what the
 * pick was for, so a pick with only those shows none.
 */
export function pickNote(
  entry: Pick<SessionHousehold, "notes" | "addedAt">,
  session: Pick<OutingSession, "startedAt">,
): FollowUp | null {
  const picked = Date.parse(entry.addedAt);
  const since =
    session.startedAt === null ? picked : Math.min(picked, Date.parse(session.startedAt));
  return (
    entry.notes.find((note) => note.doneAt === null || Date.parse(note.doneAt) >= since) ?? null
  );
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

export type RemoveBlocker = "ended" | "visited" | "last" | "block_in_use";

/*
 * Why a pick cannot be taken out, as the server would refuse it and in its
 * order, or null. The last pick in a block takes the block out with it, so
 * it stays while that block holds this session's visits: an admin may
 * record off the list there, at a door nobody picked.
 */
export function removeBlocker(
  entry: SessionHousehold,
  entries: readonly SessionHousehold[],
  status: OutingSession["status"],
  blocks: readonly Pick<SessionBlock, "block" | "visitCount">[],
): RemoveBlocker | null {
  if (status === "ended") return "ended";
  if (entry.visitedInSession) return "visited";
  if (entries.length <= 1) return "last";
  const shared = entries.some(
    (other) => other.household.id !== entry.household.id && other.block.id === entry.block.id,
  );
  const visits = blocks.find((block) => block.block.id === entry.block.id)?.visitCount ?? 0;
  return !shared && visits > 0 ? "block_in_use" : null;
}

export const REMOVE_BLOCKED: Record<Exclude<RemoveBlocker, "ended">, string> = {
  visited: "Visited in this session, so it stays.",
  last: "A follow-up session needs at least one household, so the last one can't be removed.",
  block_in_use: "Its block has visits recorded in this session, so it stays.",
};

/*
 * What members see of these picks, once that differs from the count beside
 * the heading: a pick done before the start, or taken off the follow-up
 * list, stays picked but is not on their list.
 */
export function membersSee(
  entries: readonly SessionHousehold[],
  status: OutingSession["status"],
): string | null {
  const seen = entries.filter((entry) => entry.onList).length;
  if (status === "ended" || seen === entries.length) return null;
  if (status === "draft") {
    return seen === 0
      ? "Members would see none of these."
      : `Members will see ${String(seen)} of these.`;
  }
  return seen === 0
    ? "Members see none of these right now."
    : `Members see ${String(seen)} of these.`;
}

/*
 * Why Start waits, as the server would refuse it: nothing picked is still
 * owed, so members would open an empty list. Null while the picks are
 * unread, so a slow read never holds a start the server would take.
 */
export function startBlocker(onList: number | null): string | null {
  return onList === 0
    ? "Every household here is done or off the follow-up list, so members would find nothing to visit. Add households to start it."
    : null;
}
