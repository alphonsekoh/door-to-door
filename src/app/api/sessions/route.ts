import { getDatabase } from "@/db/client";
import {
  zCreateSessionBody,
  zCreateSessionResponse,
  zListSessionsQuery,
  zListSessionsResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toOutingSession } from "@/server/sessions/serialise";
import { createSession, listSessions } from "@/server/sessions/service";

export const GET = withContract(
  {
    operationId: "listSessions",
    query: zListSessionsQuery,
    responses: { 200: zListSessionsResponse },
  },
  async ({ query }) => {
    await currentUser("admin");
    // limit and offset carry contract defaults, so they are always present.
    const { limit, offset } = query;

    const { rows, total } = await listSessions(getDatabase(), {
      limit,
      offset,
      ...(query.status === undefined ? {} : { status: query.status }),
    });

    return {
      status: 200,
      body: {
        data: rows.map(toOutingSession),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
      },
    };
  },
);

export const POST = withContract(
  {
    operationId: "createSession",
    body: zCreateSessionBody,
    responses: { 201: zCreateSessionResponse },
  },
  async ({ body }) => {
    const admin = await currentUser("admin");
    const session = await createSession(getDatabase(), {
      title: body.title,
      ...(body.blockIds === undefined ? {} : { blockIds: body.blockIds }),
      createdBy: admin.id,
    });
    return { status: 201, body: toOutingSession(session) };
  },
);
