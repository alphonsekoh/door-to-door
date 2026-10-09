import { getDatabase } from "@/db/client";
import { zDetachSessionBlockPath } from "@/generated/zod.gen";
import { z } from "zod";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { detachBlock, getSession } from "@/server/sessions/service";

export const DELETE = withContract(
  {
    operationId: "detachSessionBlock",
    path: zDetachSessionBlockPath,
    responses: { 204: z.undefined() },
  },
  async ({ path }) => {
    await currentUser("admin");
    const db = getDatabase();
    await getSession(db, path.id);
    await detachBlock(db, path.id, path.blockId);
    return { status: 204 };
  },
);
