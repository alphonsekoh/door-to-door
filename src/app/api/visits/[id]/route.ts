import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zUpdateVisitBody, zUpdateVisitPath, zUpdateVisitResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { requireChanges, withContract } from "@/server/http/contract";
import { toVisit } from "@/server/visits/serialise";
import { updateVisit } from "@/server/visits/service";

export const PATCH = withContract(
  {
    operationId: "updateVisit",
    path: zUpdateVisitPath,
    body: zUpdateVisitBody,
    responses: { 200: zUpdateVisitResponse },
  },
  async ({ path, body }) => {
    const user = requireUser(await currentSession());
    const changes = requireChanges(body);
    const visit = await updateVisit(getDatabase(), path.id, changes, {
      id: user.id,
      role: user.role,
    });
    return { status: 200, body: toVisit(visit) };
  },
);
