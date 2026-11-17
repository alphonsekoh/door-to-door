import type { Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { isNetworkFailure } from "@/lib/teams/team-ui";

/*
 * Affordance only: the server decides (D-16-2). `teamIds` must be teams the
 * server has said the viewer is on now - never the snapshot on the visit,
 * which records who was there, not who may edit (D-74-17).
 */
export type AmendRoute = "admin" | "author" | "team" | null;

type Viewer = { userId: string | undefined; isAdmin: boolean; teamIds: readonly string[] };

/* Which right the screen believes the viewer holds, so a refusal can be
   explained in terms of the right that was lost. */
export function amendRoute(visit: Pick<Visit, "member" | "team">, viewer: Viewer): AmendRoute {
  if (viewer.isAdmin) return "admin";
  if (viewer.userId !== undefined && visit.member.id === viewer.userId) return "author";
  return visit.team !== null && viewer.teamIds.includes(visit.team.id) ? "team" : null;
}

export function mayAmendVisit(visit: Pick<Visit, "member" | "team">, viewer: Viewer): boolean {
  return amendRoute(visit, viewer) !== null;
}

/*
 * A teammate can be removed between loading a record and saving it; the
 * server then refuses with 403. That is said plainly rather than as a raw
 * server message, and a lost connection never claims nothing happened.
 */
export function describeAmendFailure(error: unknown, route: AmendRoute = null): string {
  if (isNetworkFailure(error)) {
    return "Could not confirm. Refresh to see whether it went through.";
  }
  if (error instanceof ApiRequestError && error.code === "account_deactivated") {
    return "Your sign-in has ended. Sign in again.";
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    /* Only someone let in through the team lost it by leaving the team; a
       demoted admin's token still says admin (D-83-3) and was never on it. */
    return route === "team"
      ? "You are not on this record's team any more, so you cannot amend it. Its author or an admin still can."
      : "You can no longer amend this record.";
  }
  return failureLine(error, "Could not save this change.");
}
