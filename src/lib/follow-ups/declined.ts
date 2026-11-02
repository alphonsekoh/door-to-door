import type { FollowUp } from "@/generated/types.gen";
import { loadAllFollowUps } from "@/lib/follow-ups/pages";
import { formatDay } from "@/lib/history/dates";
import { displayName } from "@/lib/teams/team-ui";

/* Long enough to be seen after a week away, short enough not to nag. */
export const DECLINED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/* How many the notice shows before "Show all". */
export const NOTICE_FIRST = 3;

/*
 * Every one of the member's notes someone else took away in the window, a
 * suggestion declined or a note removed from the follow-up list, newest
 * first. The server leaves out what the author withdrew themself, which is
 * not news to them, so no page is spent on it; and every page is read, as
 * D-74-61 does for users, since the author is owed every reason (D-117-28,
 * D-117-35).
 */
export async function loadRemovalsForAuthor(
  userId: string,
  now: number,
  pageSize = 100,
): Promise<FollowUp[]> {
  return loadAllFollowUps(
    {
      deleted: "true",
      authorId: userId,
      removedByOthers: "true",
      deletedSince: new Date(now - DECLINED_WINDOW_MS).toISOString(),
    },
    pageSize,
  );
}

export type RemovedNote = FollowUp & { deletedAt: string };

/* What this phone has not been told yet, in the server's order. */
export function removedForAuthor(
  notes: readonly FollowUp[],
  seen: ReadonlySet<string>,
): RemovedNote[] {
  return notes.filter((note): note is RemovedNote => note.deletedAt !== null && !seen.has(note.id));
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
