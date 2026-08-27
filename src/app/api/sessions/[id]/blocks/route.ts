import { getDatabase } from "@/db/client";
import {
  zAttachSessionBlocksBody,
  zAttachSessionBlocksPath,
  zAttachSessionBlocksResponse,
  zListSessionBlocksPath,
  zListSessionBlocksResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toSessionBlock } from "@/server/sessions/serialise";
import { attachBlocks, getSession, listSessionBlocks } from "@/server/sessions/service";

export const GET = withContract(
  {
    operationId: "listSessionBlocks",
    path: zListSessionBlocksPath,
    responses: { 200: zListSessionBlocksResponse },
  },
  async ({ path }) => {
    await currentUser();
    const db = getDatabase();
    // Confirms the session exists, so an unknown id is 404 not an empty list.
    await getSession(db, path.id);
    const blocks = await listSessionBlocks(db, path.id);
    return { status: 200, body: blocks.map(toSessionBlock) };
  },
);

export const POST = withContract(
  {
    operationId: "attachSessionBlocks",
    path: zAttachSessionBlocksPath,
    body: zAttachSessionBlocksBody,
    responses: { 200: zAttachSessionBlocksResponse },
  },
  async ({ path, body }) => {
    await currentUser("admin");
    const db = getDatabase();
    /*
     * Permitted while the session is active: this is the contingency path, an
     * admin adding a block mid-outing that members pick up on refresh.
     */
    await getSession(db, path.id);
    await attachBlocks(db, path.id, body.blockIds);
    const blocks = await listSessionBlocks(db, path.id);
    return { status: 200, body: blocks.map(toSessionBlock) };
  },
);
