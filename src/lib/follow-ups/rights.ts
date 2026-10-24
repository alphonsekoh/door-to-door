import type { ActiveSession, FollowUp } from "@/generated/types.gen";
import { waitingSentence } from "@/lib/follow-ups/waiting";
import { displayName, firstName } from "@/lib/teams/team-ui";

/*
 * Who may do what to a follow-up, as the screens offer it. Affordance only:
 * the server decides every change (D-16-2), and these mirror its table so a
 * button is never offered only to be refused.
 */

export type Viewer = { userId: string | undefined; isAdmin: boolean };

type Listable = Pick<FollowUp, "status" | "householdId" | "doneAt" | "deletedAt">;

/*
 * The server's list rule, on the client: listed, not removed, at a household
 * the running follow-up session picked, and still owed or resolved since the
 * session started. `active` is null when nothing is running or it is unknown.
 */
export function onActiveList(note: Listable, active: ActiveSession | null): boolean {
  if (active?.session.kind !== "follow_up") return false;
  if (note.status !== "listed" || note.deletedAt !== null) return false;
  if (!active.householdIds.includes(note.householdId)) return false;
  if (note.doneAt === null) return true;
  const started = active.session.startedAt;
  return started !== null && Date.parse(note.doneAt) >= Date.parse(started);
}

export type FollowUpRights = {
  canResolve: boolean;
  canEditText: boolean;
  /* Dismiss, remove from the list, or withdraw one's own suggestion. */
  canRemove: boolean;
  canPromote: boolean;
  /* A member looking at a listed note they could resolve, but only during
     the follow-up session whose list it is on. */
  locked: boolean;
  /* A suggestion waiting at this resolved note's door, where the viewer
     could otherwise reopen it: an admin's reopen lists it too, and a
     member's would be refused, so it is said instead. */
  waitingSuggestion: { by: string; mine: boolean } | null;
};

type Rated = Listable & Pick<FollowUp, "author" | "waitingSuggestionBy">;

function waitingFor(note: Rated, viewer: Viewer): FollowUpRights["waitingSuggestion"] {
  const by = note.waitingSuggestionBy;
  if (note.doneAt === null || by === null) return null;
  return { by: firstName(by.name), mine: viewer.userId !== undefined && by.id === viewer.userId };
}

export function followUpRights(
  note: Rated,
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
      waitingSuggestion: waitingFor(note, viewer),
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
      waitingSuggestion: null,
    };
  }
  const now = onActiveList(note, active);
  /* Only where reopening would otherwise be offered. */
  const waiting = now ? waitingFor(note, viewer) : null;
  return {
    canResolve: now && waiting === null,
    canEditText: own && now,
    canRemove: false,
    canPromote: false,
    locked: !now,
    waitingSuggestion: waiting,
  };
}

/* What the viewer is told where a reopen meets a waiting suggestion. */
export function waitingCaption(waiting: { by: string; mine: boolean }, isAdmin: boolean): string {
  const whose = waiting.mine ? "your" : `${waiting.by}'s`;
  if (isAdmin) return `Reopening also adds ${whose} suggestion to the list.`;
  return waitingSentence({ name: waiting.by, mine: waiting.mine });
}

export type HouseholdAction =
  | { kind: "add_to_list" }
  /* An admin, at a household a member has suggested: listing it is adding
     that suggestion, never a second note beside it. */
  | { kind: "promote"; suggestion: FollowUp }
  | { kind: "suggest" }
  | { kind: "waiting"; by: string }
  | { kind: "listed" };

/*
 * What a household's header offers. A household already owed says so to
 * everyone. Otherwise an admin lists it, by adding a waiting suggestion when
 * there is one; a member suggests it, unless a suggestion already waits.
 * Nothing is offered that the server would refuse.
 */
export function householdAction(notes: readonly FollowUp[], viewer: Viewer): HouseholdAction {
  if (notes.some((note) => note.status === "listed" && note.doneAt === null)) {
    return { kind: "listed" };
  }
  const waiting = notes.find((note) => note.status === "suggested");
  if (waiting === undefined) return { kind: viewer.isAdmin ? "add_to_list" : "suggest" };
  if (viewer.isAdmin) return { kind: "promote", suggestion: waiting };
  const own = viewer.userId !== undefined && waiting.author.id === viewer.userId;
  return { kind: "waiting", by: own ? "you" : displayName(waiting.author.name) };
}

/* The words for each action, the same on every screen that offers it. */
export const ADD_TO_LIST = "Add to follow-up list";
export const SUGGEST = "Suggest a return visit";
export const ON_THE_LIST = "On the follow-up list";

export function waitingLabel(by: string): string {
  return `Suggested by ${by}, waiting for review`;
}
