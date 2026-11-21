import { getDatabase } from "@/db/client";
import { zUnblockUserPath, zUnblockUserResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toUser } from "@/server/users/serialise";
import { unblockUser } from "@/server/users/service";

/* Puts a rejected account back in the queue (#249). */
export const POST = withContract(
  {
    operationId: "unblockUser",
    path: zUnblockUserPath,
    responses: { 200: zUnblockUserResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return { status: 200, body: toUser(await unblockUser(getDatabase(), path.id)) };
  },
);
