import { getDatabase } from "@/db/client";
import { zEraseErasureRequestPath, zEraseErasureRequestResponse } from "@/generated/zod.gen";
import { currentUser } from "@/server/auth/session";
import { withContract } from "@/server/http/contract";
import { eraseRequest } from "@/server/privacy/requests";
import { toErasureRequest } from "@/server/privacy/serialise";

/* Carrying a request out cannot be undone, so it is an admin's alone (#279). */
export const POST = withContract(
  {
    operationId: "eraseErasureRequest",
    path: zEraseErasureRequestPath,
    responses: { 200: zEraseErasureRequestResponse },
  },
  async ({ path }) => {
    const admin = await currentUser("admin");
    const request = await eraseRequest(
      getDatabase(),
      path.id,
      { id: admin.id, role: "admin" },
      new Date(),
    );
    return { status: 200, body: toErasureRequest(request) };
  },
);
