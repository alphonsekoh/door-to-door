import { getDatabase } from "@/db/client";
import {
  zAddTeamMemberBody,
  zAddTeamMemberPath,
  zAddTeamMemberResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toTeam } from "@/server/teams/serialise";
import { addTeamMember } from "@/server/teams/service";

export const POST = withContract(
  {
    operationId: "addTeamMember",
    path: zAddTeamMemberPath,
    body: zAddTeamMemberBody,
    responses: { 200: zAddTeamMemberResponse },
  },
  async ({ path, body }) => {
    const user = await currentUser();
    const team = await addTeamMember(getDatabase(), user, path.id, body.userId);
    return { status: 200, body: toTeam(team) };
  },
);
