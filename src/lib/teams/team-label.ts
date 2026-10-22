import type { Visit } from "@/generated/types.gen";
import { displayName } from "@/lib/teams/team-ui";

/*
 * Who made a record, as a line of words.
 *
 * The teammates come from the snapshot frozen onto the visit when the server
 * stored it (D-74-20), shown with today's names. It says who was there, not
 * who may edit it now: access is the team's CURRENT membership (D-74-17), so
 * nothing here may be used to decide what someone can do.
 */

type Stamped = Pick<Visit, "member" | "team">;

export function teammateNames(visit: Stamped): string[] {
  return (visit.team?.members ?? []).map((member) => displayName(member.name));
}

/* "Alice Tan with Ben Lim, Chris Ong" - the author always first. */
export function visitByline(visit: Stamped): string {
  const author = displayName(visit.member.name);
  const others = teammateNames(visit);
  return others.length === 0 ? author : `${author} with ${others.join(", ")}`;
}

export function teamName(visit: Stamped): string | null {
  return visit.team?.name ?? null;
}
