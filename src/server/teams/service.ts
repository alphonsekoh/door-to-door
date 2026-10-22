import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role, SessionStatus } from "@/db/schema";
import {
  outingSessions,
  sessionParticipants,
  sessionTeamMembers,
  sessionTeams,
  users,
} from "@/db/schema";
import { checkTeamName } from "@/lib/teams/team-name";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/http/errors";
import { isCurrentMember, VISIT_TEAM_FK, type PersonRow } from "@/server/teams/access";

/*
 * Outings' participants and teams.
 *
 * Authorization is decided here, not in the handlers (D-16-2), so a caller
 * that skips a handler still meets it. Every operation is online-only: team
 * state is server truth and is never queued (D-74-19).
 */

export type Actor = { id: string; role: Role };

export type TeamRow = {
  id: string;
  sessionId: string;
  name: string;
  createdAt: Date;
  members: PersonRow[];
};

export type ParticipantRow = { user: PersonRow; teamId: string | null; joinedAt: Date };

/* One team per member per outing; also what makes concurrent creates safe. */
const ONE_TEAM_PER_OUTING = "session_team_members_session_user_unique";
const TEAM_MEMBER_PK = "session_team_members_team_id_user_id_pk";

type SessionInfo = { id: string; status: SessionStatus };

async function loadSession(db: Database, id: string): Promise<SessionInfo> {
  const found = await db
    .select({ id: outingSessions.id, status: outingSessions.status })
    .from(outingSessions)
    .where(eq(outingSessions.id, id))
    .limit(1);
  const session = found[0];
  if (!session) {
    throw new NotFoundError("No such session.");
  }
  return session;
}

const notActive = (message: string) => new ConflictError("session_not_active", message);

/* Members see only the live outing; admins see any. */
function assertReadable(actor: Actor, session: SessionInfo): void {
  if (actor.role !== "admin" && session.status !== "active") {
    throw new ForbiddenError("Only an admin can see a session that is not active.");
  }
}

export async function joinSession(
  db: Database,
  actor: Actor,
  sessionId: string,
): Promise<ParticipantRow> {
  const session = await loadSession(db, sessionId);
  const joinable =
    session.status === "active" || (session.status === "draft" && actor.role === "admin");
  if (!joinable) {
    throw notActive(
      session.status === "ended" ? "That session has ended." : "That session has not started yet.",
    );
  }

  await db
    .insert(sessionParticipants)
    .values({ sessionId, userId: actor.id })
    .onConflictDoNothing();

  return firstOrThrow(await listParticipantRows(db, sessionId, actor.id), "the participant");
}

async function listParticipantRows(
  db: Database,
  sessionId: string,
  onlyUserId?: string,
): Promise<ParticipantRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      joinedAt: sessionParticipants.joinedAt,
      teamId: sessionTeamMembers.teamId,
    })
    .from(sessionParticipants)
    .innerJoin(users, eq(users.id, sessionParticipants.userId))
    .leftJoin(
      sessionTeamMembers,
      and(
        eq(sessionTeamMembers.sessionId, sessionParticipants.sessionId),
        eq(sessionTeamMembers.userId, sessionParticipants.userId),
      ),
    )
    // A deactivated person cannot be added or work, so a picker should not offer them.
    .where(
      and(
        eq(sessionParticipants.sessionId, sessionId),
        isNull(users.deactivatedAt),
        ...(onlyUserId === undefined ? [] : [eq(sessionParticipants.userId, onlyUserId)]),
      ),
    )
    .orderBy(asc(sessionParticipants.joinedAt), asc(users.id));

  return rows.map((row) => ({
    user: { id: row.id, name: row.name, image: row.image },
    teamId: row.teamId,
    joinedAt: row.joinedAt,
  }));
}

export async function listParticipants(
  db: Database,
  actor: Actor,
  sessionId: string,
): Promise<ParticipantRow[]> {
  assertReadable(actor, await loadSession(db, sessionId));
  return listParticipantRows(db, sessionId);
}

async function loadTeams(db: Database, where: SQL): Promise<TeamRow[]> {
  const teams = await db
    .select()
    .from(sessionTeams)
    .where(where)
    .orderBy(asc(sessionTeams.createdAt), asc(sessionTeams.id));
  if (teams.length === 0) return [];

  const members = await db
    .select({
      teamId: sessionTeamMembers.teamId,
      id: users.id,
      name: users.name,
      image: users.image,
    })
    .from(sessionTeamMembers)
    .innerJoin(users, eq(users.id, sessionTeamMembers.userId))
    .where(
      and(
        inArray(
          sessionTeamMembers.teamId,
          teams.map((team) => team.id),
        ),
        isNull(users.deactivatedAt),
      ),
    )
    .orderBy(asc(sessionTeamMembers.joinedAt), asc(users.id));

  const byTeam = new Map<string, PersonRow[]>();
  for (const { teamId, ...person } of members) {
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), person]);
  }
  return teams.map((team) => ({
    id: team.id,
    sessionId: team.sessionId,
    name: team.name,
    createdAt: team.createdAt,
    members: byTeam.get(team.id) ?? [],
  }));
}

async function getTeam(db: Database, id: string): Promise<TeamRow> {
  return firstOrThrow(await loadTeams(db, eq(sessionTeams.id, id)), "the team");
}

export async function listTeams(db: Database, actor: Actor, sessionId: string): Promise<TeamRow[]> {
  assertReadable(actor, await loadSession(db, sessionId));
  return loadTeams(db, eq(sessionTeams.sessionId, sessionId));
}

function validName(raw: string): string {
  const checked = checkTeamName(raw);
  if (!checked.ok) {
    throw new ValidationError(checked.message);
  }
  return checked.name;
}

export async function createTeam(
  db: Database,
  actor: Actor,
  sessionId: string,
  input: { name: string; memberIds?: string[] | undefined },
): Promise<TeamRow> {
  const session = await loadSession(db, sessionId);
  if (session.status === "ended") {
    throw notActive("That session has ended.");
  }
  if (session.status === "draft" && actor.role !== "admin") {
    throw notActive("That session has not started yet.");
  }
  const name = validName(input.name);

  // A member is always on the team they form; an admin only if they list themselves.
  const listed = [...(input.memberIds ?? [])];
  const ids = [...new Set(actor.role === "admin" ? listed : [actor.id, ...listed])];

  await assertPlaceable(db, actor, sessionId, ids);

  try {
    const teamId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(sessionTeams)
        .values({ sessionId, name, createdBy: actor.id })
        .returning({ id: sessionTeams.id });
      const id = firstOrThrow(inserted, "the team insert").id;
      await placeMembers(tx, id, sessionId, ids);
      return id;
    });
    return await getTeam(db, teamId);
  } catch (error) {
    return rethrowTeamConflict(error);
  }
}

/*
 * Checks everyone about to join a team: they exist, are active, are on no team
 * in this outing, and - when a member is doing the adding - have joined it.
 * An admin may reach anyone, which also makes them a participant.
 */
async function assertPlaceable(
  db: Database,
  actor: Actor,
  sessionId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;

  const found = await db
    .select({ id: users.id, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(inArray(users.id, userIds));
  if (found.length !== userIds.length) {
    throw new NotFoundError("One or more of those people do not exist.");
  }
  if (found.some((user) => user.deactivatedAt !== null)) {
    throw new ConflictError("conflict", "One or more of those people are deactivated.");
  }

  const taken = await db
    .select({ userId: sessionTeamMembers.userId })
    .from(sessionTeamMembers)
    .where(
      and(eq(sessionTeamMembers.sessionId, sessionId), inArray(sessionTeamMembers.userId, userIds)),
    );
  if (taken.length > 0) {
    throw new ConflictError(
      "conflict",
      taken.some((row) => row.userId === actor.id)
        ? "You are already on a team in this session."
        : "One or more of those people are already on a team in this session.",
    );
  }

  if (actor.role !== "admin") {
    // The caller joins by creating or adding, so only the others need to have joined.
    const others = userIds.filter((id) => id !== actor.id);
    if (others.length === 0) return;
    const joined = await db
      .select({ userId: sessionParticipants.userId })
      .from(sessionParticipants)
      .where(
        and(
          eq(sessionParticipants.sessionId, sessionId),
          inArray(sessionParticipants.userId, others),
        ),
      );
    if (joined.length !== others.length) {
      throw new ConflictError(
        "conflict",
        "One or more of those people have not joined this session.",
      );
    }
  }
}

async function placeMembers(
  db: Database,
  teamId: string,
  sessionId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .insert(sessionTeamMembers)
    .values(userIds.map((userId) => ({ teamId, sessionId, userId })));
  await db
    .insert(sessionParticipants)
    .values(userIds.map((userId) => ({ sessionId, userId })))
    .onConflictDoNothing();
}

/* A lost race on the unique indexes is a conflict the client can explain. */
function rethrowTeamConflict(error: unknown): never {
  if (
    isConstraintViolation(error, ONE_TEAM_PER_OUTING) ||
    isConstraintViolation(error, TEAM_MEMBER_PK)
  ) {
    throw new ConflictError("conflict", "Someone is already on a team in this session.");
  }
  throw error;
}

type LoadedTeam = { id: string; sessionId: string; status: SessionStatus };

/*
 * Every team operation starts here: the team exists, a member is on it, and a
 * member's outing is still active. Admins skip both - they fix teams after the
 * fact, including on an ended outing.
 */
async function loadTeamFor(db: Database, actor: Actor, teamId: string): Promise<LoadedTeam> {
  const found = await db
    .select({
      id: sessionTeams.id,
      sessionId: sessionTeams.sessionId,
      status: outingSessions.status,
    })
    .from(sessionTeams)
    .innerJoin(outingSessions, eq(outingSessions.id, sessionTeams.sessionId))
    .where(eq(sessionTeams.id, teamId))
    .limit(1);
  const team = found[0];
  if (!team) {
    throw new NotFoundError("No such team.");
  }

  if (actor.role !== "admin") {
    if (!(await isCurrentMember(db, actor.id, teamId))) {
      throw new ForbiddenError("You are not on that team.");
    }
    if (team.status !== "active") {
      throw notActive("That session is not active, so its teams can no longer be changed.");
    }
  }
  return team;
}

export async function renameTeam(
  db: Database,
  actor: Actor,
  teamId: string,
  rawName: string,
): Promise<TeamRow> {
  await loadTeamFor(db, actor, teamId);
  const name = validName(rawName);
  await db.update(sessionTeams).set({ name }).where(eq(sessionTeams.id, teamId));
  return getTeam(db, teamId);
}

/*
 * Left to the foreign key rather than counted first: a visit stamped between
 * a count and the delete would otherwise slip through.
 */
export async function deleteTeam(db: Database, actor: Actor, teamId: string): Promise<void> {
  await loadTeamFor(db, actor, teamId);
  try {
    await db.delete(sessionTeams).where(eq(sessionTeams.id, teamId));
  } catch (error) {
    if (isConstraintViolation(error, VISIT_TEAM_FK)) {
      throw new ConflictError(
        "conflict",
        "Records were made as this team, so it cannot be disbanded. Remove its members instead.",
      );
    }
    throw error;
  }
}

export async function addTeamMember(
  db: Database,
  actor: Actor,
  teamId: string,
  userId: string,
): Promise<TeamRow> {
  const team = await loadTeamFor(db, actor, teamId);
  await assertPlaceable(db, actor, team.sessionId, [userId]);
  try {
    await db.transaction((tx) => placeMembers(tx, teamId, team.sessionId, [userId]));
  } catch (error) {
    return rethrowTeamConflict(error);
  }
  return getTeam(db, teamId);
}

export async function removeTeamMember(
  db: Database,
  actor: Actor,
  teamId: string,
  userId: string,
): Promise<TeamRow> {
  await loadTeamFor(db, actor, teamId);
  if (actor.role !== "admin" && userId !== actor.id) {
    throw new ForbiddenError("You can only remove yourself from a team.");
  }
  const removed = await db
    .delete(sessionTeamMembers)
    .where(and(eq(sessionTeamMembers.teamId, teamId), eq(sessionTeamMembers.userId, userId)))
    .returning({ userId: sessionTeamMembers.userId });
  if (removed.length === 0) {
    throw new NotFoundError("That person is not on the team.");
  }
  return getTeam(db, teamId);
}
