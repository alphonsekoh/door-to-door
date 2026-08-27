import { getDatabase } from "@/db/client";
import { zListHouseholdsQuery, zListHouseholdsResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { listHouseholds } from "@/server/visits/queries";
import { toHouseholdSummary } from "@/server/visits/serialise";

export const GET = withContract(
  {
    operationId: "listHouseholds",
    query: zListHouseholdsQuery,
    responses: { 200: zListHouseholdsResponse },
  },
  async ({ query }) => {
    await currentUser();
    const { limit, offset, blockId } = query;

    const { rows, total } = await listHouseholds(getDatabase(), {
      blockId,
      limit,
      offset,
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toHouseholdSummary),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);
