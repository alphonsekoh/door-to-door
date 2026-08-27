import { getDatabase } from "@/db/client";
import { zListHistoryQuery, zListHistoryResponse } from "@/generated/zod.gen";
import { toHistoryEntry } from "@/server/history/serialise";
import { listHistory } from "@/server/history/service";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";

/*
 * The consolidated view, admin only. Members use /history/mine instead - a
 * separate operation rather than a filter, so there is deliberately no
 * parameter combination here that could widen a member's view.
 */
export const GET = withContract(
  {
    operationId: "listHistory",
    query: zListHistoryQuery,
    responses: { 200: zListHistoryResponse },
  },
  async ({ query }) => {
    await currentUser("admin");
    const { limit, offset } = query;

    const { rows, total } = await listHistory(getDatabase(), {
      limit,
      offset,
      ...(query.memberId === undefined ? {} : { memberId: query.memberId }),
      ...(query.blockId === undefined ? {} : { blockId: query.blockId }),
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
      ...(query.interestLevel === undefined ? {} : { interestLevel: query.interestLevel }),
      ...(query.religion === undefined ? {} : { religion: query.religion }),
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
