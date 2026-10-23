import type { ActiveSession, FollowUp } from "@/generated/types.gen";
import { displayName } from "@/lib/teams/team-ui";

/*
 * Who may do what to a follow-up, as the screens offer it. Affordance only:
 * the server decides every change (D-16-2), and these mirror its table so a
 * button is never offered only to be refused.
 */

export type Viewer = { userId: string | undefined; isAdmin: boolean };

type Listable = Pick<FollowUp, "status" | "blockId" | "doneAt" | "deletedAt">;

/*
 * The server's list rule, on the client: listed, not removed, in one of the
 * running follow-up session's blocks, and still owed or resolved since the
 * session started. `active` is null when nothing is running or it is unknown.
 */
export function onActiveList(note: Listable, active: ActiveSession | null): boolean {
  if (active?.session.kind !== "follow_up") return false;
  if (note.status !== "listed" || note.deletedAt !== null) return false;
  if (!active.blocks.some((entry) => entry.block.id === note.blockId)) return false;
  if (note.doneAt === null) return true;
  const started = active.session.startedAt;
  return started !== null && Date.parse(note.doneAt) >= Date.parse(started);
}

export type FollowUpRights = {
  /* Mark done, or reopen. */
  canResolve: boolean;
  /* Change the words or the due date. */
  canEditText: boolean;
  /* Dismiss, remove from the list, or withdraw one's own suggestion. */
  canRemove: boolean;
  /* Add a suggestion to the follow-up list. */
  canPromote: boolean;
  /* A member looking at a listed note they could resolve, but only during
     the follow-up session whose list it is on. */
  locked: boolean;
};

export function followUpRights(
  note: Listable & Pick<FollowUp, "author">,
  viewer: Viewer,
  active: ActiveSession | null,
): FollowUpRights {
  const listed = note.status === "listed";
  if (viewer.isAdmin) {
    return {
      canResolve: listed,
      canEditText: true,
      canRemove: true,
      canPromote: !listed,
      locked: false,
    };
  }
  const own = viewer.userId !== undefined && note.author.id === viewer.userId;
  if (!listed) {
    // A suggestion is its author's until an admin acts on it.
    return {
      canResolve: false,
      canEditText: own,
      canRemove: own,
      canPromote: false,
      locked: false,
    };
  }
  const now = onActiveList(note, active);
  return {
    canResolve: now,
    canEditText: own && now,
    canRemove: false,
    canPromote: false,
    locked: !now,
  };
}

export type HouseholdAction =
  | { kind: "add_to_list" }
  | { kind: "suggest" }
  | { kind: "waiting"; by: string }
  | { kind: "listed" };

/*
 * What a household's header offers. An admin can always list it; a member
 * can suggest it unless it is already owed or already waiting for review,
 * when the header says so instead of offering a button the server refuses.
 */
export function householdAction(
  notes: readonly Pick<FollowUp, "status" | "doneAt" | "author">[],
  viewer: Viewer,
): HouseholdAction {
  if (viewer.isAdmin) return { kind: "add_to_list" };
  if (notes.some((note) => note.status === "listed" && note.doneAt === null)) {
    return { kind: "listed" };
  }
  const waiting = notes.find((note) => note.status === "suggested");
  if (waiting !== undefined) {
    const own = viewer.userId !== undefined && waiting.author.id === viewer.userId;
    return { kind: "waiting", by: own ? "you" : displayName(waiting.author.name) };
  }
  return { kind: "suggest" };
}

/* The words for each action, the same on every screen that offers it. */
export const ADD_TO_LIST = "Add to follow-up list";
export const SUGGEST = "Suggest a return visit";
export const ON_THE_LIST = "On the follow-up list";

export function waitingLabel(by: string): string {
  return `Suggested by ${by}, waiting for review`;
}
