import type { FollowUp } from "@/generated/types.gen";

/* Long enough to be seen after a week away, short enough not to nag. */
export const DECLINED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * The member's suggestions an admin removed without adding them to the list,
 * so the author is told. One the author withdrew themself was not declined.
 */
export function declinedSuggestions(
  notes: readonly FollowUp[],
  now: number,
  seen: ReadonlySet<string>,
): FollowUp[] {
  return notes.filter(
    (note) =>
      note.status === "suggested" &&
      note.deletedAt !== null &&
      note.deletedBy !== null &&
      note.deletedBy.id !== note.author.id &&
      now - Date.parse(note.deletedAt) <= DECLINED_WINDOW_MS &&
      !seen.has(note.id),
  );
}
