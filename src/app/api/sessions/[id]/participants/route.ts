import { getDatabase } from "@/db/client";
import { zListParticipantsPath, zListParticipantsResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toParticipant } from "@/server/teams/serialise";
import { listParticipants } from "@/server/teams/service";

export const GET = withContract(
  {
    operationId: "listParticipants",
    path: zListParticipantsPath,
    responses: { 200: zListParticipantsResponse },
  },
  async ({ path }) => {
    const user = await currentUser();
    const rows = await listParticipants(getDatabase(), user, path.id);
    return { status: 200, body: { data: rows.map(toParticipant) } };
  },
);
