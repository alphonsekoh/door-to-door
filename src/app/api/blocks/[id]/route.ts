import { getDatabase } from "@/db/client";
import { zUpdateBlockBody, zUpdateBlockPath, zUpdateBlockResponse } from "@/generated/zod.gen";
import { toBlock } from "@/server/blocks/serialise";
import { updateBlock } from "@/server/blocks/service";
import { requireChanges, withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";

export const PATCH = withContract(
  {
    operationId: "updateBlock",
    path: zUpdateBlockPath,
    body: zUpdateBlockBody,
    responses: { 200: zUpdateBlockResponse },
  },
  async ({ path, body }) => {
    await currentUser("admin");
    const changes = requireChanges(body);
    return { status: 200, body: toBlock(await updateBlock(getDatabase(), path.id, changes)) };
  },
);
