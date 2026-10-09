import { getDatabase } from "@/db/client";
import { zStartSessionPath, zStartSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toOutingSession } from "@/server/sessions/serialise";
import { transitionSession } from "@/server/sessions/service";

export const POST = withContract(
  {
    operationId: "startSession",
    path: zStartSessionPath,
    responses: { 200: zStartSessionResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    const session = await transitionSession(getDatabase(), path.id, "start");
    return { status: 200, body: toOutingSession(session) };
  },
);
