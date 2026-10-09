import type { Participant, Team } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";

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

/* "Ann & Ben" from the caller's and partner's first names. */
export function defaultTeamName(me: string | null, partner: string | null): string {
  return `${firstName(me)} & ${firstName(partner)}`;
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
  /* The request never reached the server. */
  network: boolean;
};

/* fetch rejects with a TypeError when there is no connection. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export function describeTeamFailure(error: unknown): TeamFailure {
  if (isNetworkFailure(error)) {
    return { message: "You seem to be offline. Nothing was changed.", network: true };
  }
  const generic = { message: "Could not change your team. Try again.", network: false };
  if (!(error instanceof ApiRequestError)) return generic;

  const message = (() => {
    if (error.code === "session_not_active") {
      return "This outing is not running, so teams can no longer change.";
    }
    if (error.code === "account_deactivated" || error.status === 401) {
      return "Your sign-in has ended. Sign in again.";
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
  return { message, network: false };
}
