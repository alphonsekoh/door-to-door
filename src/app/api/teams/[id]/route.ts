import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  zDeleteTeamPath,
  zUpdateTeamBody,
  zUpdateTeamPath,
  zUpdateTeamResponse,
} from "@/generated/zod.gen";
import { withContract } from "@/server/http/contract";
import { currentUser } from "@/server/auth/session";
import { toTeam } from "@/server/teams/serialise";
import { deleteTeam, renameTeam } from "@/server/teams/service";

export const PATCH = withContract(
  {
    operationId: "updateTeam",
    path: zUpdateTeamPath,
    body: zUpdateTeamBody,
    responses: { 200: zUpdateTeamResponse },
  },
  async ({ path, body }) => {
    const user = await currentUser();
    return { status: 200, body: toTeam(await renameTeam(getDatabase(), user, path.id, body.name)) };
  },
);

export const DELETE = withContract(
  {
    operationId: "deleteTeam",
    path: zDeleteTeamPath,
    responses: { 204: z.undefined() },
  },
  async ({ path }) => {
    const user = await currentUser();
    await deleteTeam(getDatabase(), user, path.id);
    return { status: 204 };
  },
);
