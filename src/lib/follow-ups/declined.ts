import type { FollowUp } from "@/generated/types.gen";
import { formatDay } from "@/lib/history/dates";
import { displayName } from "@/lib/teams/team-ui";

/* Long enough to be seen after a week away, short enough not to nag. */
export const DECLINED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * The member's notes someone else took away, a suggestion declined or a note
 * removed from the follow-up list, so the author is told and why. One the
 * author withdrew themself is not news to them.
 */
export type RemovedNote = FollowUp & { deletedAt: string };

export function removedForAuthor(
  notes: readonly FollowUp[],
  now: number,
  seen: ReadonlySet<string>,
): RemovedNote[] {
  return notes.filter(
    (note): note is RemovedNote =>
      note.deletedAt !== null &&
      note.deletedBy !== null &&
      note.deletedBy.id !== note.author.id &&
      now - Date.parse(note.deletedAt) <= DECLINED_WINDOW_MS &&
      !seen.has(note.id),
  );
}

/* "Declined by Ben · 3 Mar 2026: we visited last week". Older removals,
   from before a reason was required, may have none. */
export function authorNoticeLine(
  note: Pick<FollowUp, "status" | "deletedBy" | "deleteReason"> & { deletedAt: string },
): string {
  const how = note.status === "suggested" ? "Declined" : "Removed from the follow-up list";
  const by = `${how} by ${displayName(note.deletedBy?.name ?? null)} · ${formatDay(note.deletedAt)}`;
  return note.deleteReason === null ? by : `${by}: ${note.deleteReason}`;
}
