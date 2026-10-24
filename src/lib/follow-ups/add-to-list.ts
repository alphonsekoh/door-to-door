import type { OutingSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Adding a door to the follow-up list and, when the admin keeps the box
 * ticked, to a follow-up session: two requests, so the API stays one thing
 * per call, and a second that fails is said plainly rather than undoing the
 * first.
 */

export const ADDED_TO_LIST = "Added to the follow-up list.";

export function addedMessage(target: OutingSession | null): string {
  return target === null ? ADDED_TO_LIST : `Added to the follow-up list and to ${target.title}.`;
}

export function partialMessage(target: OutingSession): string {
  return `Added to the follow-up list, but not to ${target.title}. Try again, or add it from the session's page.`;
}

export function addToSession(target: OutingSession, householdId: string): Promise<unknown> {
  return apiFetch(`/sessions/${target.id}/households`, {
    method: "POST",
    body: JSON.stringify({ householdIds: [householdId] }),
  });
}

export type AddOutcome =
  | { status: "done"; message: string }
  /* On the list, but not in the session: only the session step is retried. */
  | { status: "partial"; target: OutingSession };

/* A failed list step throws, and nothing has changed. */
export async function listThenAdd(
  list: () => Promise<unknown>,
  householdId: string,
  target: OutingSession | null,
): Promise<AddOutcome> {
  await list();
  if (target === null) return { status: "done", message: ADDED_TO_LIST };
  try {
    await addToSession(target, householdId);
  } catch {
    return { status: "partial", target };
  }
  return { status: "done", message: addedMessage(target) };
}
