import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zSyncVisitsBody, zSyncVisitsResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { SYNC_BODY_LIMIT_BYTES } from "@/server/http/body-limit";
import { withContract } from "@/server/http/contract";
import { RateLimitedError } from "@/server/http/errors";
import { assertBatchClockSane, currentClock } from "@/server/visits/clock-rules";
import { syncLimiter } from "@/server/visits/rate-limits";
import { toRecordedVisit } from "@/server/visits/serialise";
import { syncVisits } from "@/server/visits/sync";

export const POST = withContract(
  {
    operationId: "syncVisits",
    body: zSyncVisitsBody,
    maxBodyBytes: SYNC_BODY_LIMIT_BYTES,
    responses: { 200: zSyncVisitsResponse },
  },
  async ({ body }) => {
    const user = requireUser(await currentSession());

    if (!syncLimiter.consume(user.id).allowed) {
      throw new RateLimitedError("Too many sync requests. Try again shortly.");
    }

    const clock = currentClock();
    assertBatchClockSane(new Date(body.sentAt), clock);

    const outcomes = await syncVisits(getDatabase(), body.items, { id: user.id }, clock);

    return {
      status: 200,
      body: {
        results: outcomes.map((outcome) => ({
          id: outcome.id,
          status: outcome.status,
          visit: outcome.visit === null ? null : toRecordedVisit(outcome.visit, outcome.markedDone),
          error: outcome.error === null ? null : outcome.error.toBody(),
        })),
      },
    };
  },
);
