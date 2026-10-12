import type { Participant, Team } from "@/generated/types.gen";
import type { ParticipantRow, TeamRow } from "@/server/teams/service";

export function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    members: row.members,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toParticipant(row: ParticipantRow): Participant {
  return { user: row.user, teamId: row.teamId, joinedAt: row.joinedAt.toISOString() };
}
