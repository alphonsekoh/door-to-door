import type { Participant, Team, User } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import { MAX_TEAM_NAME_LENGTH, checkTeamName } from "@/lib/teams/team-name";

/* D-74-1: the one limit of teams, said where people form them. */
export const UNSYNCED_LIMIT_NOTE =
  "A teammate sees and edits your records once they have synced. A record still waiting on your phone is only on your phone.";

export const OFFLINE_NOTE = "Connect to change your team";

export const ADMIN_OFFLINE_NOTE = "Connect to change teams";

/* D-74-1 again, for the person arranging other people's teams. */
export const ADMIN_UNSYNCED_NOTE =
  "Teammates see and edit each other's records once they have synced. A record still waiting on a phone is only on that phone.";

export const NAME_FALLBACK = "Someone";

/* A user with no name still has to be listed and tapped. */
export function displayName(name: string | null): string {
  return name === null || name.trim() === "" ? NAME_FALLBACK : name.trim();
}

export function firstName(name: string | null): string {
  return displayName(name).replace(/\s.*$/, "");
}

/* "Ann", "Ann & Ben", "Ann, Ben & Cy" from first names. Long first names can
   exceed the limit, so it is cut by code point, and a cut that leaves
   something unshowable (or nobody chosen) falls back to a plain word. */
export function suggestTeamName(names: (string | null)[]): string {
  const firsts = names.map(firstName);
  const last = firsts.pop() ?? "";
  const full = firsts.length === 0 ? last : `${firsts.join(", ")} & ${last}`;
  const cut = Array.from(full).slice(0, MAX_TEAM_NAME_LENGTH).join("");
  return checkTeamName(cut).ok ? cut : "Team";
}

/* "Ann & Ben" from the caller's and partner's first names. */
export function defaultTeamName(me: string | null, partner: string | null): string {
  return suggestTeamName([me, partner]);
}

/* Joined people who are free to be added: not me, not already on a team. The
   server excludes deactivated people and refuses the rest again. */
export function pickerCandidates(participants: Participant[], meId: string): Participant[] {
  return participants.filter(({ user, teamId }) => user.id !== meId && teamId === null);
}

/*
 * Who an admin may place: anyone active not already on a team in this outing
 * (D-74-15). `GET /users` already leaves deactivated people out; the server
 * refuses the rest again.
 */
export function adminCandidates(users: User[], teams: Team[]): User[] {
  const placed = new Set(teams.flatMap((team) => team.members.map((member) => member.id)));
  return users.filter((user) => !placed.has(user.id));
}

export function findMyTeam(teams: Team[], meId: string): Team | undefined {
  return teams.find((team) => team.members.some((member) => member.id === meId));
}

export function hasJoined(participants: Participant[], meId: string): boolean {
  return participants.some(({ user }) => user.id === meId);
}

/* Team state is server truth and is never queued (D-74-19). */
export function canChangeTeam(online: boolean, outingActive: boolean): boolean {
  return online && outingActive;
}

export type TeamFailure = {
  message: string;
  /* The request never got an answer: offline, or the connection dropped. */
  network: boolean;
  /* The sign-in is gone; nothing on the card can work. */
  auth: boolean;
};

/* fetch rejects with a TypeError when there is no connection. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/*
 * A read that fails with no answer changed nothing. A change that fails with
 * no answer may have: the connection can drop after the request was sent, so
 * it must never claim that nothing happened.
 */
export function describeTeamFailure(
  error: unknown,
  kind: "read" | "change" = "change",
): TeamFailure {
  if (isNetworkFailure(error)) {
    return {
      message:
        kind === "read"
          ? "You seem to be offline."
          : "Could not confirm. Refresh to see whether it went through.",
      network: true,
      auth: false,
    };
  }
  const generic = {
    message: "Could not change your team. Try again.",
    network: false,
    auth: false,
  };
  if (!(error instanceof ApiRequestError)) return generic;

  if (error.code === "account_deactivated" || error.status === 401) {
    return { message: "Your sign-in has ended. Sign in again.", network: false, auth: true };
  }
  const message = (() => {
    if (error.code === "session_not_active") {
      return "This session is not running, so teams can no longer change.";
    }
    switch (error.status) {
      case 400:
        return "That team name was not accepted.";
      case 403:
        return "You are not allowed to change that team.";
      case 404:
        return "That team or person is no longer there. Refresh to see the latest.";
      case 409:
        return "Someone is already on a team, or has not joined this session yet. Refresh to see the latest.";
      default:
        return generic.message;
    }
  })();
  return { message, network: false, auth: false };
}

export type AdminTeamAction = "create" | "rename" | "add" | "remove" | "delete";

/*
 * The admin panel's wording. An admin is never asked to join, so the member
 * card's 409 line would mislead, and a team that did work cannot be deleted
 * (D-74-18) - the way out is removing its members.
 */
export function describeAdminTeamFailure(error: unknown, action: AdminTeamAction): TeamFailure {
  const base = describeTeamFailure(error, "change");
  if (!(error instanceof ApiRequestError) || base.auth) return base;
  if (error.status === 403) {
    return { ...base, message: "Only an admin can change these teams." };
  }
  if (error.status === 409 && error.code === "conflict") {
    return {
      ...base,
      message:
        action === "delete"
          ? "This team has records and cannot be removed; remove its members instead."
          : "Someone is already on a team in this session, or is no longer active. Refresh to see the latest.",
    };
  }
  if (error.code === "session_not_active") {
    return { ...base, message: "This session has ended, so no new team can be formed." };
  }
  return error.status === 400 || error.status === 404
    ? base
    : { ...base, message: "Could not change the team. Try again." };
}
