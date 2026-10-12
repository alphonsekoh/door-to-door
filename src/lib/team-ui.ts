import type { Participant, Team } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import { MAX_TEAM_NAME_LENGTH, checkTeamName } from "@/lib/team-name";

/* D-74-1: the one limit of teams, said where people form them. */
export const UNSYNCED_LIMIT_NOTE =
  "A teammate sees and edits your records once they have synced. A record still waiting on your phone is only on your phone.";

export const OFFLINE_NOTE = "Connect to change your team";

export const NAME_FALLBACK = "Someone";

/* A user with no name still has to be listed and tapped. */
export function displayName(name: string | null): string {
  return name === null || name.trim() === "" ? NAME_FALLBACK : name.trim();
}

export function firstName(name: string | null): string {
  return displayName(name).replace(/\s.*$/, "");
}

/* "Ann & Ben" from the caller's and partner's first names. Two long first
   names can exceed the limit, so it is cut by code point, and a cut that
   leaves something unshowable falls back to a plain word. */
export function defaultTeamName(me: string | null, partner: string | null): string {
  const full = `${firstName(me)} & ${firstName(partner)}`;
  const cut = Array.from(full).slice(0, MAX_TEAM_NAME_LENGTH).join("");
  return checkTeamName(cut).ok ? cut : "Team";
}

/* Joined people who are free to be added: not me, not already on a team. The
   server excludes deactivated people and refuses the rest again. */
export function pickerCandidates(participants: Participant[], meId: string): Participant[] {
  return participants.filter(({ user, teamId }) => user.id !== meId && teamId === null);
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
      return "This outing is not running, so teams can no longer change.";
    }
    switch (error.status) {
      case 400:
        return "That team name was not accepted.";
      case 403:
        return "You are not allowed to change that team.";
      case 404:
        return "That team or person is no longer there. Refresh to see the latest.";
      case 409:
        return "Someone is already on a team, or has not joined this outing yet. Refresh to see the latest.";
      default:
        return generic.message;
    }
  })();
  return { message, network: false, auth: false };
}
