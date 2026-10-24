import { z } from "zod";
import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zRemoveFollowUpBody, zRemoveFollowUpPath } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { removeFollowUp } from "@/server/follow-ups/service";
import { withContract } from "@/server/http/contract";

/*
 * A POST with a body, not a DELETE with a query, so the reason (free text
 * about a household) never lands in a URL and so in a proxy or access log.
 */
export const POST = withContract(
  {
    operationId: "removeFollowUp",
    path: zRemoveFollowUpPath,
    body: zRemoveFollowUpBody,
    responses: { 204: z.undefined() },
  },
  async ({ path, body }) => {
    const user = requireUser(await currentSession());
    await removeFollowUp(getDatabase(), path.id, { id: user.id, role: user.role }, body.reason);
    return { status: 204 };
  },
);
