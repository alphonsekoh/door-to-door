import { getDatabase } from "@/db/client";
import { zEndSessionPath, zEndSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toOutingSession } from "@/server/sessions/serialise";
import { transitionSession } from "@/server/sessions/service";

export const POST = withContract(
  {
    operationId: "endSession",
    path: zEndSessionPath,
    responses: { 200: zEndSessionResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    const session = await transitionSession(getDatabase(), path.id, "end");
    return { status: 200, body: toOutingSession(session) };
  },
);
