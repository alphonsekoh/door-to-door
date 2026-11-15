import { getDatabase } from "@/db/client";
import {
  zGetHouseholdHistoryPath,
  zGetHouseholdHistoryQuery,
  zGetHouseholdHistoryResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { getHouseholdHistory } from "@/server/visits/queries";
import { toHouseholdHistory } from "@/server/visits/serialise";

/*
 * A unit's timeline, across every session and member, a page of visits at a
 * time (#160). This is what a member sees before knocking, and the reason
 * the household/visit split exists.
 */
export const GET = withContract(
  {
    operationId: "getHouseholdHistory",
    path: zGetHouseholdHistoryPath,
    query: zGetHouseholdHistoryQuery,
    responses: { 200: zGetHouseholdHistoryResponse },
  },
  async ({ path, query }) => {
    await currentUser();
    const { limit, offset } = query;
    const rows = await getHouseholdHistory(getDatabase(), path.id, { limit, offset });

    return {
      status: 200,
      body: toHouseholdHistory(rows, {
        limit,
        offset,
        total: rows.total,
        hasMore: offset + rows.visits.length < rows.total,
      }),
    };
  },
);
