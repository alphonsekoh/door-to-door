import { getDatabase } from "@/db/client";
import { zGetSessionPath, zGetSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toOutingSession } from "@/server/sessions/serialise";
import { getSession } from "@/server/sessions/service";

export const GET = withContract(
  {
    operationId: "getSession",
    path: zGetSessionPath,
    responses: { 200: zGetSessionResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return { status: 200, body: toOutingSession(await getSession(getDatabase(), path.id)) };
  },
);
