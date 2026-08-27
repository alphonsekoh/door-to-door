import { getDatabase } from "@/db/client";
import {
  zCreateBlockBody,
  zCreateBlockResponse,
  zListBlocksQuery,
  zListBlocksResponse,
} from "@/generated/zod.gen";
import { toBlock } from "@/server/blocks/serialise";
import { createBlock, listBlocks } from "@/server/blocks/service";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";

/* Readable by anyone signed in: members pick blocks from this registry. */
export const GET = withContract(
  {
    operationId: "listBlocks",
    query: zListBlocksQuery,
    responses: { 200: zListBlocksResponse },
  },
  async ({ query }) => {
    await currentUser();
    const { limit, offset } = query;

    const { rows, total } = await listBlocks(getDatabase(), {
      limit,
      offset,
      ...(query.search === undefined ? {} : { search: query.search }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toBlock),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);

export const POST = withContract(
  {
    operationId: "createBlock",
    body: zCreateBlockBody,
    responses: { 201: zCreateBlockResponse },
  },
  async ({ body }) => {
    await currentUser("admin");
    const block = await createBlock(getDatabase(), {
      name: body.name,
      street: body.street,
      ...(body.postalCode === undefined ? {} : { postalCode: body.postalCode }),
    });
    return { status: 201, body: toBlock(block) };
  },
);
