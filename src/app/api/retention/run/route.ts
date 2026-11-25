import { getDatabase } from "@/db/client";
import { zRunRetentionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { checkCronBearer } from "@/server/privacy/cron";
import { runRetention } from "@/server/privacy/retention";
import { toRetentionRun } from "@/server/privacy/serialise";

/* Room for a run that has several hundred erasures to make. */
export const maxDuration = 60;

/*
 * The scheduler's trigger (#279): no session, only CRON_SECRET's bearer. The
 * secret is checked first, so a refused call reads nothing, not even the
 * database URL. The clock has no tolerance: nothing here is compared with a
 * phone's.
 */
export const GET = withContract(
  {
    operationId: "runRetention",
    responses: { 200: zRunRetentionResponse },
  },
  async ({ request }) => {
    checkCronBearer(request);
    const run = await runRetention(getDatabase(), { now: new Date(), toleranceMs: 0 });
    return { status: 200, body: toRetentionRun(run) };
  },
);
