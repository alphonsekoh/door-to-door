import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import {
  zCreateFollowUpBody,
  zCreateFollowUpResponse,
  zListFollowUpsQuery,
  zListFollowUpsResponse,
} from "@/generated/zod.gen";
import { requireUser, resolveMemberScope } from "@/server/auth/guards";
import { ForbiddenError } from "@/server/http/errors";
import { createFollowUp, listFollowUps } from "@/server/follow-ups/service";
import { withContract } from "@/server/http/contract";
import { toFollowUp } from "@/server/visits/serialise";

export const GET = withContract(
  {
    operationId: "listFollowUps",
    query: zListFollowUpsQuery,
    responses: { 200: zListFollowUpsResponse },
  },
  async ({ query }) => {
    const session = await currentSession();
    const user = requireUser(session);
    const { limit, offset } = query;

    /*
     * A member may filter to their own notes but not to anyone else's;
     * resolveMemberScope raises 403 rather than quietly widening the view.
     * Notes on a household stay visible to everyone who can reach the unit,
     * which is the point of writing them down.
     */
    if (query.authorId !== undefined) {
      resolveMemberScope(session, query.authorId);
    }

    /*
     * Removed notes are an admin's audit trail. A member may read only their
     * own, to learn that a suggestion was not added and why.
     */
    if (query.deleted && user.role !== "admin" && query.authorId !== user.id) {
      throw new ForbiddenError("Only an admin can see removed follow-ups.");
    }

    const { rows, total } = await listFollowUps(getDatabase(), {
      limit,
      offset,
      ...(query.householdId === undefined ? {} : { householdId: query.householdId }),
      ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.outstanding === undefined ? {} : { outstanding: query.outstanding }),
      ...(query.dueBefore === undefined ? {} : { dueBefore: query.dueBefore }),
      deleted: query.deleted,
    });

    return {
      status: 200,
      body: {
        data: rows.map(toFollowUp),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);

export const POST = withContract(
  {
    operationId: "createFollowUp",
    body: zCreateFollowUpBody,
    responses: { 201: zCreateFollowUpResponse },
  },
  async ({ body }) => {
    const user = requireUser(await currentSession());
    // The caller's role decides: an admin lists it, a member suggests it.
    const created = await createFollowUp(
      getDatabase(),
      {
        householdId: body.householdId,
        visitId: body.visitId,
        note: body.note,
        dueDate: body.dueDate,
      },
      { id: user.id, role: user.role },
    );
    return { status: 201, body: toFollowUp(created) };
  },
);
