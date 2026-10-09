import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zListOwnHistoryQuery, zListOwnHistoryResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { toHistoryEntry } from "@/server/history/serialise";
import { listHistory } from "@/server/history/service";
import { withContract } from "@/server/http/contract";

/*
 * The caller's own records. memberId is taken from the session and never from
 * the request, so there is nothing to widen - that is the point of this being
 * a separate operation rather than a filter on /history.
 */
export const GET = withContract(
  {
    operationId: "listOwnHistory",
    query: zListOwnHistoryQuery,
    responses: { 200: zListOwnHistoryResponse },
  },
  async ({ query }) => {
    const user = requireUser(await currentSession());
    const { limit, offset } = query;

    const { rows, total } = await listHistory(getDatabase(), {
      memberId: user.id,
      limit,
      offset,
      ...(query.blockId === undefined ? {} : { blockId: query.blockId }),
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
      ...(query.interestLevel === undefined ? {} : { interestLevel: query.interestLevel }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toHistoryEntry),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);
