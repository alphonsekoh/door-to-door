import { getDatabase } from "@/db/client";
import { zRemoveTeamMemberPath, zRemoveTeamMemberResponse } from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toTeam } from "@/server/teams/serialise";
import { removeTeamMember } from "@/server/teams/service";

export const DELETE = withContract(
  {
    operationId: "removeTeamMember",
    path: zRemoveTeamMemberPath,
    responses: { 200: zRemoveTeamMemberResponse },
  },
  async ({ path }) => {
    const user = await currentUser();
    const team = await removeTeamMember(getDatabase(), user, path.id, path.userId);
    return { status: 200, body: toTeam(team) };
  },
);
