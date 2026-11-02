import { getDatabase } from "@/db/client";
import { zListSessionRevisitsPath, zListSessionRevisitsResponse } from "@/generated/zod.gen";
import { toBlock } from "@/server/blocks/serialise";
import { listRevisits } from "@/server/follow-ups/revisits";
import { withContract } from "@/server/http/contract";
import { ConflictError, ForbiddenError } from "@/server/http/errors";
import { currentUser } from "@/server/auth/session";
import { getSession } from "@/server/sessions/service";
import { toFollowUp, toHousehold, toVisit } from "@/server/visits/serialise";

/*
 * The households a follow-up session goes back to. Members read the running
 * session's list; an admin may also read a draft's, to check it before
 * starting, or an ended one's.
 */
export const GET = withContract(
  {
    operationId: "listSessionRevisits",
    path: zListSessionRevisitsPath,
    responses: { 200: zListSessionRevisitsResponse },
  },
  async ({ path }) => {
    const user = await currentUser();
    const db = getDatabase();
    const session = await getSession(db, path.id);

    if (user.role !== "admin" && session.status !== "active") {
      throw new ForbiddenError("You can see a session's follow-up list only while it is running.");
    }
    if (session.kind !== "follow_up") {
      throw new ConflictError(
        "conflict",
        "This is a regular session, so it has no follow-up list.",
      );
    }

    const entries = await listRevisits(db, session);
    return {
      status: 200,
      body: {
        data: entries.map((entry) => ({
          household: toHousehold(entry.household),
          block: toBlock(entry.block),
          notes: entry.notes.map(toFollowUp),
          latestVisit: entry.latestVisit === null ? null : toVisit(entry.latestVisit),
          visitedInSession: entry.visitedInSession,
        })),
      },
    };
  },
);
