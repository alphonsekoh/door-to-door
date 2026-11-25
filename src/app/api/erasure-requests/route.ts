import { getDatabase } from "@/db/client";
import {
  zCreateErasureRequestBody,
  zCreateErasureRequestResponse,
  zListErasureRequestsQuery,
  zListErasureRequestsResponse,
} from "@/generated/zod.gen";
import { currentUser } from "@/server/auth/session";
import { withContract } from "@/server/http/contract";
import { createErasureRequest, listErasureRequests } from "@/server/privacy/requests";
import { toErasureRequest, toRetentionRun } from "@/server/privacy/serialise";
import { currentClock } from "@/server/visits/clock-rules";

/* Admin's list of requests (#279), with the retention job's last run beside it. */
export const GET = withContract(
  {
    operationId: "listErasureRequests",
    query: zListErasureRequestsQuery,
    responses: { 200: zListErasureRequestsResponse },
  },
  async ({ query }) => {
    await currentUser("admin");
    const { status, limit, offset } = query;
    const { rows, total, lastRun } = await listErasureRequests(getDatabase(), {
      status,
      limit,
      offset,
    });
    return {
      status: 200,
      body: {
        data: rows.map(toErasureRequest),
        pagination: { limit, offset, total, hasMore: offset + rows.length < total },
        lastRetentionRun: lastRun === null ? null : toRetentionRun(lastRun),
      },
    };
  },
);

/*
 * A member passes on a householder's request; only an admin logs an account's.
 * The service refuses a member naming an account, so the rule holds for any
 * caller of it, not just this handler.
 */
export const POST = withContract(
  {
    operationId: "createErasureRequest",
    body: zCreateErasureRequestBody,
    responses: { 200: zCreateErasureRequestResponse, 201: zCreateErasureRequestResponse },
  },
  async ({ body }) => {
    const user = await currentUser();
    const { request, created } = await createErasureRequest(
      getDatabase(),
      {
        kind: body.kind,
        id: body.id,
        ...(body.requestedAt === undefined ? {} : { requestedAt: body.requestedAt }),
      },
      { id: user.id, role: user.role },
      currentClock(),
    );
    return { status: created ? 201 : 200, body: toErasureRequest(request) };
  },
);
