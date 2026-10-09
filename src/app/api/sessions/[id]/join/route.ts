import { getDatabase } from "@/db/client";
import { zJoinSessionPath, zJoinSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toParticipant } from "@/server/teams/serialise";
import { joinSession } from "@/server/teams/service";

/* Acts on the caller only: there is no user in the path or body to name. */
export const POST = withContract(
  {
    operationId: "joinSession",
    path: zJoinSessionPath,
    responses: { 200: zJoinSessionResponse },
  },
  async ({ path }) => {
    const user = await currentUser();
    return { status: 200, body: toParticipant(await joinSession(getDatabase(), user, path.id)) };
  },
);
