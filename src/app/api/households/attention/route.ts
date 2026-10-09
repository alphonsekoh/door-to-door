import { getDatabase } from "@/db/client";
import {
  zListHouseholdsNeedingAttentionQuery,
  zListHouseholdsNeedingAttentionResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { listHouseholdsNeedingAttention } from "@/server/visits/queries";
import { toHouseholdAttention } from "@/server/visits/serialise";

/*
 * The doors that said yes and were never gone back to.
 *
 * Admin-only: it is a work list across every block and member, which is not a
 * view a member has any use for.
 */
export const GET = withContract(
  {
    operationId: "listHouseholdsNeedingAttention",
    query: zListHouseholdsNeedingAttentionQuery,
    responses: { 200: zListHouseholdsNeedingAttentionResponse },
  },
  async ({ query }) => {
    await currentUser("admin");
    const { limit, offset, minimumInterest } = query;

    const { rows, total } = await listHouseholdsNeedingAttention(getDatabase(), {
      /*
       * The contract's enum covers all four levels, but only medium and high
       * mean interest. Anything else is read as high rather than returning a
       * list whose name would be a lie.
       */
      minimumInterest: minimumInterest === "medium" ? "medium" : "high",
      limit,
      offset,
      ...(query.blockId === undefined ? {} : { blockId: query.blockId }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toHouseholdAttention),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);
