import { HAS_SUBSTANCE, NON_PRINTING, nameLength, type NameCheck } from "@/lib/session/own-name";

/* Matches CreateTeamRequest.name in the contract. */
export const MAX_TEAM_NAME_LENGTH = 60;

/*
 * Same hygiene as a display name - a team name is read by everyone on the
 * outing - with its own length and wording.
 */
export function checkTeamName(raw: string): NameCheck {
  const name = raw.trim();
  if (name === "") return { ok: false, message: "Enter a team name." };
  if (nameLength(name) > MAX_TEAM_NAME_LENGTH) {
    return {
      ok: false,
      message: `Keep the team name to ${String(MAX_TEAM_NAME_LENGTH)} characters.`,
    };
  }
  if (NON_PRINTING.test(name)) {
    return { ok: false, message: "The team name has characters that cannot be shown." };
  }
  if (!HAS_SUBSTANCE.test(name)) {
    return { ok: false, message: "The team name needs at least one letter or number." };
  }
  return { ok: true, name };
}
