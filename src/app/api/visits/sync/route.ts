import { currentSession } from "@/server/auth/session";
import { getDatabase } from "@/db/client";
import { zSyncVisitsBody, zSyncVisitsResponse } from "@/generated/zod.gen";
import { requireUser } from "@/server/auth/guards";
import { createRateLimiter } from "@/server/auth/rate-limit";
import { withContract } from "@/server/http/contract";
import { RateLimitedError } from "@/server/http/errors";
import { assertBatchClockSane, currentClock } from "@/server/visits/clock-rules";
import { toVisit } from "@/server/visits/serialise";
import { syncVisits } from "@/server/visits/sync";

/*
 * A queue flush is a burst, not a stream: generous per member, but bounded so
 * one client cannot hammer the database on a retry loop.
 */
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export const POST = withContract(
  {
    operationId: "syncVisits",
    body: zSyncVisitsBody,
    responses: { 200: zSyncVisitsResponse },
  },
  async ({ body }) => {
    const user = requireUser(await currentSession());

    if (!limiter.consume(user.id).allowed) {
      throw new RateLimitedError("Too many sync requests. Try again shortly.");
    }

    const clock = currentClock();
    assertBatchClockSane(new Date(body.sentAt), clock);

    const outcomes = await syncVisits(
      getDatabase(),
      body.items,
      { id: user.id, role: user.role },
      clock,
    );

    return {
      status: 200,
      body: {
        results: outcomes.map((outcome) => ({
          id: outcome.id,
          status: outcome.status,
          visit: outcome.visit === null ? null : toVisit(outcome.visit),
          error: outcome.error === null ? null : outcome.error.toBody(),
        })),
      },
    };
  },
);
