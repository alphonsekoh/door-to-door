import type { Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import { isNetworkFailure } from "@/lib/team-ui";

/*
 * Affordance only: the server decides (D-16-2). `teamIds` must be teams the
 * server has said the viewer is on now - never the snapshot on the visit,
 * which records who was there, not who may edit (D-74-17).
 */
export function mayAmendVisit(
  visit: Pick<Visit, "member" | "team">,
  viewer: { userId: string | undefined; isAdmin: boolean; teamIds: readonly string[] },
): boolean {
  if (viewer.isAdmin) return true;
  if (viewer.userId !== undefined && visit.member.id === viewer.userId) return true;
  return visit.team !== null && viewer.teamIds.includes(visit.team.id);
}

/*
 * A teammate can be removed between loading a record and saving it; the
 * server then refuses with 403. That is said plainly rather than as a raw
 * server message, and a lost connection never claims nothing happened.
 */
export function describeAmendFailure(error: unknown): string {
  if (isNetworkFailure(error)) {
    return "Could not confirm. Refresh to see whether it went through.";
  }
  if (error instanceof ApiRequestError && error.code === "account_deactivated") {
    return "Your sign-in has ended. Sign in again.";
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return "You are not on this record's team any more, so you cannot amend it. Its author or an admin still can.";
  }
  return error instanceof Error ? error.message : "Could not save this change.";
}
