import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import {
  zUpdateFollowUpBody,
  zUpdateFollowUpPath,
  zUpdateFollowUpResponse,
} from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { updateFollowUp } from "@/server/follow-ups/service";
import { requireChanges, withContract } from "@/server/http/contract";
import { toFollowUp } from "@/server/visits/serialise";

export const PATCH = withContract(
  {
    operationId: "updateFollowUp",
    path: zUpdateFollowUpPath,
    body: zUpdateFollowUpBody,
    responses: { 200: zUpdateFollowUpResponse },
  },
  async ({ path, body }) => {
    const user = requireUser(await currentSession());
    const changes = requireChanges(body);
    const updated = await updateFollowUp(getDatabase(), path.id, changes, {
      id: user.id,
      role: user.role,
    });
    return { status: 200, body: toFollowUp(updated) };
  },
);
