import { getDatabase } from "@/db/client";
import { zReopenSessionPath, zReopenSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toOutingSession } from "@/server/sessions/serialise";
import { transitionSession } from "@/server/sessions/service";

export const POST = withContract(
  {
    operationId: "reopenSession",
    path: zReopenSessionPath,
    responses: { 200: zReopenSessionResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    const session = await transitionSession(getDatabase(), path.id, "reopen");
    return { status: 200, body: toOutingSession(session) };
  },
);
