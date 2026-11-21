import { getDatabase } from "@/db/client";
import { zApproveUserPath, zApproveUserResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toUser } from "@/server/users/serialise";
import { approveUser } from "@/server/users/service";

/* Lets someone waiting for approval in, as a member (#249). */
export const POST = withContract(
  {
    operationId: "approveUser",
    path: zApproveUserPath,
    responses: { 200: zApproveUserResponse },
  },
  async ({ path }) => {
    await currentUser("admin");
    return { status: 200, body: toUser(await approveUser(getDatabase(), path.id)) };
  },
);
