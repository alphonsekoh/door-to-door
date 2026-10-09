import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zListOwnSessionHistoryQuery, zListOwnSessionHistoryResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { toSessionHistorySummary } from "@/server/history/serialise";
import { listOwnSessionHistory } from "@/server/history/service";
import { withContract } from "@/server/http/contract";

/*
 * The outings the caller worked. memberId comes from the session and there is
 * no parameter to widen it, for the same reason /history/mine has none.
 */
export const GET = withContract(
  {
    operationId: "listOwnSessionHistory",
    query: zListOwnSessionHistoryQuery,
    responses: { 200: zListOwnSessionHistoryResponse },
  },
  async ({ query }) => {
    const user = requireUser(await currentSession());
    const { limit, offset } = query;

    const { rows, total } = await listOwnSessionHistory(getDatabase(), {
      memberId: user.id,
      limit,
      offset,
    });

    return {
      status: 200,
      body: {
        data: rows.map(toSessionHistorySummary),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);
