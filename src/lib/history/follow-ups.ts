import { formatDay } from "@/lib/history/dates";
import type { FollowUp, Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import { displayName } from "@/lib/teams/team-ui";

/*
 * Follow-up notes, shaped for reading and for the controls around them.
 *
 * A due date is a DAY, not an instant. It is stored as the start of that day
 * in the author's time zone, and a note only becomes overdue once the whole
 * day has passed - "due today" is a reminder, not a failure.
 */

export const MAX_NOTE_LENGTH = 2000;

/* Follow-ups are server truth and never queued, like team changes. */
export const FOLLOW_UP_OFFLINE_NOTE = "Connect to change follow-ups";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/* "2026-10-14" from a date input, to the instant local midnight begins. */
export function dueDayToInstant(day: string): string | null {
  const match = DAY.exec(day);
  if (match === null) return null;
  const [, year, month, date] = match;
  return new Date(Number(year), Number(month) - 1, Number(date)).toISOString();
}

/* The reverse, for filling a date input; "" clears it. */
export function instantToDueDay(instant: string | null): string {
  if (instant === null) return "";
  const at = new Date(instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function startOfToday(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

type Dated = Pick<FollowUp, "doneAt" | "dueDate">;

export function isOverdue(note: Dated, now: Date): boolean {
  if (note.doneAt !== null || note.dueDate === null) return false;
  return Date.parse(note.dueDate) < Date.parse(startOfToday(now));
}

/* D-22-1: what to do next first, and an undated note never pushes a dated one down. */
export function sortOutstanding<T extends Pick<FollowUp, "doneAt" | "dueDate" | "createdAt">>(
  notes: readonly T[],
): T[] {
  const due = (note: T) =>
    note.dueDate === null ? Number.POSITIVE_INFINITY : Date.parse(note.dueDate);
  return notes
    .filter((note) => note.doneAt === null)
    .sort((a, b) => due(a) - due(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export type TimelineEntry =
  { kind: "visit"; at: string; item: Visit } | { kind: "note"; at: string; item: FollowUp };

/*
 * Visits and notes in one line, oldest first, so the trajectory still reads
 * left to right. On a tie the visit goes first, because a note written at the
 * door is about the knock it follows: visits are listed first and the sort is
 * stable.
 */
export function buildTimeline(
  visits: readonly Visit[],
  notes: readonly FollowUp[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...visits.map((item) => ({ kind: "visit" as const, at: item.createdAt, item })),
    ...notes.map((item) => ({ kind: "note" as const, at: item.createdAt, item })),
  ];
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/* "you" to the person it names, as the header beside it says. */
function who(user: { id: string; name: string | null } | null, viewerId?: string): string {
  if (user !== null && viewerId !== undefined && user.id === viewerId) return "you";
  return displayName(user?.name ?? null);
}

/*
 * Who put the note where it is. A member's words an admin listed say both,
 * so the list shows whose idea it was and who decided; a note listed before
 * suggestions existed names no lister and reads as before.
 */
export function addedByline(
  note: Pick<FollowUp, "author" | "createdAt" | "status" | "listedBy">,
  viewerId?: string,
): string {
  const by = `${who(note.author, viewerId)} · ${formatDay(note.createdAt)}`;
  if (note.status === "suggested") return `Suggested by ${by} · Waiting for review`;
  return note.listedBy !== null && note.listedBy.id !== note.author.id
    ? `Suggested by ${by}`
    : `Added by ${by}`;
}

export function listedByline(
  note: Pick<FollowUp, "author" | "status" | "listedAt" | "listedBy">,
  viewerId?: string,
): string | null {
  if (note.status !== "listed" || note.listedBy === null || note.listedAt === null) return null;
  if (note.listedBy.id === note.author.id) return null;
  return `Added to the list by ${who(note.listedBy, viewerId)} · ${formatDay(note.listedAt)}`;
}

/* How a removed note left, for the audit view and the author's notice. */
export function removedByline(
  note: Pick<FollowUp, "author" | "status" | "deletedAt" | "deletedBy">,
): string | null {
  if (note.deletedAt === null) return null;
  const by = `${displayName(note.deletedBy?.name ?? null)} · ${formatDay(note.deletedAt)}`;
  if (note.status === "listed") return `Removed from the list by ${by}`;
  return note.deletedBy?.id === note.author.id ? `Withdrawn by ${by}` : `Dismissed by ${by}`;
}

export function doneByline(
  note: Pick<FollowUp, "doneAt" | "doneBy">,
  viewerId?: string,
): string | null {
  if (note.doneAt === null) return null;
  return `Done by ${who(note.doneBy, viewerId)} · ${formatDay(note.doneAt)}`;
}

/* What the author of a declined suggestion is told. */
export function declinedByline(note: Pick<FollowUp, "deletedAt" | "deletedBy">): string | null {
  if (note.deletedAt === null) return null;
  return `Declined by ${displayName(note.deletedBy?.name ?? null)} · ${formatDay(note.deletedAt)}`;
}

/*
 * A change that got no answer may still have landed, so it never claims that
 * nothing happened (D-74-43). Raw server text is never shown.
 */
export function describeFollowUpFailure(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not confirm. Refresh to see whether it went through.";
  }
  if (!(error instanceof ApiRequestError)) {
    return "Could not save the follow-up. Try again.";
  }
  if (error.status === 401 || error.code === "account_deactivated") {
    return "Your sign-in has ended. Sign in again.";
  }
  switch (error.code) {
    case "follow_up_exists":
      return "This household is already on the follow-up list or has a suggestion waiting.";
    case "not_on_follow_up_list":
      return "You can change this only during a follow-up session that includes its block.";
  }
  switch (error.status) {
    case 400:
      return "That was not accepted. Check the note is not empty and the reason is short.";
    case 403:
      return "Only the person who wrote this, or an admin, can change it.";
    case 404:
      return "That note or unit is no longer there. Refresh to see the latest.";
    case 409:
      return "Add it to the follow-up list before marking it done.";
    default:
      return "Could not save the follow-up. Try again.";
  }
}
