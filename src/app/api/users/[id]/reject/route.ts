import { getDatabase } from "@/db/client";
import { zRejectUserPath, zRejectUserResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toUser } from "@/server/users/serialise";
import { rejectUser } from "@/server/users/service";

/* Turns down someone waiting for approval, blocking that account (#249). */
export const POST = withContract(
  {
    operationId: "rejectUser",
    path: zRejectUserPath,
    responses: { 200: zRejectUserResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return { status: 200, body: toUser(await rejectUser(getDatabase(), path.id)) };
  },
);
