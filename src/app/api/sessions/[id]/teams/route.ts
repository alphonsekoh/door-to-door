import { getDatabase } from "@/db/client";
import {
  zCreateTeamBody,
  zCreateTeamPath,
  zCreateTeamResponse,
  zListTeamsPath,
  zListTeamsResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/sessions/handlers";
import { toTeam } from "@/server/teams/serialise";
import { createTeam, listTeams } from "@/server/teams/service";

export const GET = withContract(
  {
    operationId: "listTeams",
    path: zListTeamsPath,
    responses: { 200: zListTeamsResponse },
  },
  async ({ path }) => {
    const user = await currentUser();
    const rows = await listTeams(getDatabase(), user, path.id);
    return { status: 200, body: { data: rows.map(toTeam) } };
  },
);

export const POST = withContract(
  {
    operationId: "createTeam",
    path: zCreateTeamPath,
    body: zCreateTeamBody,
    responses: { 201: zCreateTeamResponse },
  },
  async ({ path, body }) => {
    const user = await currentUser();
    const team = await createTeam(getDatabase(), user, path.id, body);
    return { status: 201, body: toTeam(team) };
  },
);
