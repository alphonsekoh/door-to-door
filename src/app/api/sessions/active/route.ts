import { getDatabase } from "@/db/client";
import { zGetActiveSessionResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { NotFoundError } from "@/server/http/errors";
import { currentUser } from "@/server/sessions/handlers";
import { toOutingSession, toSessionBlock } from "@/server/sessions/serialise";
import { findActiveSession, listSessionBlocks } from "@/server/sessions/service";

/* The member landing screen. Available to all roles. */
export const GET = withContract(
  { operationId: "getActiveSession", responses: { 200: zGetActiveSessionResponse } },
  async () => {
    await currentUser();
    const db = getDatabase();
    const session = await findActiveSession(db);

    if (!session) {
      /*
       * A normal state, not a failure: no outing is running. Clients render an
       * empty screen rather than an error, which is why the contract documents
       * this 404 explicitly.
       */
      throw new NotFoundError("No session is active.");
    }

    const blocks = await listSessionBlocks(db, session.id);
    return {
      status: 200,
      body: { session: toOutingSession(session), blocks: blocks.map(toSessionBlock) },
    };
  },
);
