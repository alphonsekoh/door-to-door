import { getDatabase } from "@/db/client";
import { zGetHouseholdHistoryPath, zGetHouseholdHistoryResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { getHouseholdHistory } from "@/server/visits/queries";
import { toHouseholdHistory } from "@/server/visits/serialise";

/*
 * A unit's full timeline, across every session and member. This is what a
 * member sees before knocking, and the reason the household/visit split exists.
 */
export const GET = withContract(
  {
    operationId: "getHouseholdHistory",
    path: zGetHouseholdHistoryPath,
    responses: { 200: zGetHouseholdHistoryResponse },
  },
  async ({ path }) => {
    await currentUser();
    return {
      status: 200,
      body: toHouseholdHistory(await getHouseholdHistory(getDatabase(), path.id)),
    };
  },
);
