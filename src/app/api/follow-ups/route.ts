import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import {
  zCreateFollowUpBody,
  zCreateFollowUpResponse,
  zListFollowUpsQuery,
  zListFollowUpsResponse,
} from "@/generated/zod.gen";
import { requireUser, resolveMemberScope } from "@/server/auth/guards";
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
    // Called for its guard, not its result: without it an unauthenticated
    // caller passing no authorId would reach the query.
    requireUser(session);
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

    const { rows, total } = await listFollowUps(getDatabase(), {
      limit,
      offset,
      ...(query.householdId === undefined ? {} : { householdId: query.householdId }),
      ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
      ...(query.outstanding === undefined ? {} : { outstanding: query.outstanding }),
      ...(query.dueBefore === undefined ? {} : { dueBefore: query.dueBefore }),
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
    const created = await createFollowUp(getDatabase(), {
      householdId: body.householdId,
      visitId: body.visitId,
      note: body.note,
      dueDate: body.dueDate,
      authorId: user.id,
    });
    return { status: 201, body: toFollowUp(created) };
  },
);
