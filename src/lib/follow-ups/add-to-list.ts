import type { OutingSession } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";

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

/*
 * On the list, but not in the session. `refused` is the server's reason
 * when it turned the door away (the session ended meanwhile, say): every
 * retry would be refused the same way, so none is offered. Null when the
 * request was lost or the server failed, which a retry may get past.
 */
export type HalfAdded = { target: OutingSession; refused: string | null };

export function partialMessage({ target, refused }: HalfAdded): string {
  const head = `Added to the follow-up list, but not to ${target.title}.`;
  return refused === null
    ? `${head} Try again, or add it from the session's page.`
    : `${head} ${refused}`;
}

function refusalOf(error: unknown): string | null {
  const refused = error instanceof ApiRequestError && error.status < 500 && error.status !== 429;
  return refused ? error.message : null;
}

export type AddOutcome =
  { status: "done"; message: string } | { status: "partial"; half: HalfAdded };

/* The session step alone: after the list step, and as a retry of it. */
export async function intoSession(target: OutingSession, householdId: string): Promise<AddOutcome> {
  try {
    await apiFetch(`/sessions/${target.id}/households`, {
      method: "POST",
      body: JSON.stringify({ householdIds: [householdId] }),
    });
  } catch (error) {
    return { status: "partial", half: { target, refused: refusalOf(error) } };
  }
  return { status: "done", message: addedMessage(target) };
}

/* A failed list step throws, and nothing has changed. */
export async function listThenAdd(
  list: () => Promise<unknown>,
  householdId: string,
  target: OutingSession | null,
): Promise<AddOutcome> {
  await list();
  if (target === null) return { status: "done", message: ADDED_TO_LIST };
  return intoSession(target, householdId);
}
