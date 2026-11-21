import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role } from "@/db/schema";
import { sessionTeamMembers, sessionTeams, users, visitTeammates } from "@/db/schema";
import { appendTo, getOrThrow, selectInChunks } from "@/server/db-utils";

/*
 * Team membership, and who may touch a team's records.
 *
 * Two different questions are answered here and must stay apart. The visit's
 * stamp (`team_id`, `visit_teammates`) records who was on the team when the
 * server first stored it, and is only ever displayed. Access is always the
 * CURRENT membership of `visit.team_id`: a joiner can edit earlier team
 * records, a leaver loses the teammates' ones.
 */

/* The foreign key that stops a team with stamped records being deleted. */
export const VISIT_TEAM_FK = "visits_team_id_session_teams_id_fk";

export type PersonRow = { id: string; name: string | null; image: string | null };

export type TeamStamp = { id: string; name: string; members: PersonRow[] };

export async function teamIdFor(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<string | null> {
  const found = await db
    .select({ teamId: sessionTeamMembers.teamId })
    .from(sessionTeamMembers)
    .where(and(eq(sessionTeamMembers.sessionId, sessionId), eq(sessionTeamMembers.userId, userId)))
    .limit(1);
  return found[0]?.teamId ?? null;
}

/* Everyone on the team now except the author: what gets frozen onto a visit. */
export async function snapshotTeammates(
  db: Database,
  teamId: string,
  authorId: string,
): Promise<string[]> {
  const found = await db
    .select({ userId: sessionTeamMembers.userId })
    .from(sessionTeamMembers)
    .where(and(eq(sessionTeamMembers.teamId, teamId), ne(sessionTeamMembers.userId, authorId)));
  return found.map((row) => row.userId);
}

const membership = (db: Database, userId: string, teamId: string) =>
  db
    .select({ userId: sessionTeamMembers.userId })
    .from(sessionTeamMembers)
    .where(and(eq(sessionTeamMembers.teamId, teamId), eq(sessionTeamMembers.userId, userId)))
    .limit(1);

export async function isCurrentMember(
  db: Database,
  userId: string,
  teamId: string,
  lock?: "key share",
): Promise<boolean> {
  const query = membership(db, userId, teamId);
  return (await (lock === undefined ? query : query.for(lock))).length > 0;
}

/*
 * Who may amend a visit: an admin, its author, or a current member of the
 * team it is stamped with. Whether the outing is still open is a separate
 * rule the caller applies, since sync and the REST endpoint report it
 * differently.
 *
 * The membership is read FOR KEY SHARE: inside an amend's transaction a
 * removal from the team then waits for the amend to commit, rather than
 * landing between this check and the write.
 */
export async function canAmend(
  db: Database,
  actor: { id: string; role: Role },
  visit: { memberId: string; teamId: string | null },
): Promise<boolean> {
  if (actor.role === "admin" || visit.memberId === actor.id) return true;
  if (visit.teamId === null) return false;
  return (await membership(db, actor.id, visit.teamId).for("key share")).length > 0;
}

/*
 * Joins the author to the outing as a side effect of recording. Admins are
 * never auto-joined (D-74-13): they supervise rather than knock. Whether the
 * author is active is the caller's to judge: createVisit under the author's
 * lock, sync per request, since its author is always the caller (D-83-11).
 */
export async function autoJoin(db: Database, sessionId: string, userId: string): Promise<void> {
  await db.execute(sql`
    insert into session_participants (session_id, user_id)
    select ${sessionId}::uuid, id from users where id = ${userId}::uuid and role = 'member'
    on conflict do nothing
  `);
}

/*
 * Stamps a freshly inserted visit with its author's team and freezes the
 * teammates. Runs only for a row this call inserted, so a replay or a lost
 * race never writes a second snapshot.
 */
export async function stampVisit(
  db: Database,
  visitId: string,
  teamId: string | null,
  authorId: string,
): Promise<void> {
  await stampVisits(db, [visitId], teamId, authorId);
}

/* stampVisit for visits one author just inserted together: one snapshot, one insert. */
export async function stampVisits(
  db: Database,
  visitIds: readonly string[],
  teamId: string | null,
  authorId: string,
): Promise<void> {
  if (teamId === null) return;
  const mates = await snapshotTeammates(db, teamId, authorId);
  if (mates.length === 0) return;
  await db
    .insert(visitTeammates)
    .values(visitIds.flatMap((visitId) => mates.map((userId) => ({ visitId, userId }))))
    .onConflictDoNothing();
}

/*
 * Adds `team` to visit rows: the stamped teams' names, and their snapshots
 * joined to current user names, read together (#252). Two queries for up to
 * 10,000 visits, so a page of a hundred costs no more than one (D-20-3); past
 * that, one more per 10,000 (#126), although a household's history now
 * passes one page (#160). Each visit's teammates come from one query, in name
 * order.
 */
export async function attachTeams<T extends { id: string; teamId: string | null }>(
  db: Database,
  rows: T[],
): Promise<(T & { team: TeamStamp | null })[]> {
  const stamped = rows.filter((row) => row.teamId !== null);
  if (stamped.length === 0) {
    return rows.map((row) => ({ ...row, team: null }));
  }

  const teamIds = [...new Set(stamped.map((row) => row.teamId).filter((id) => id !== null))];
  const visitIds = [...new Set(stamped.map((row) => row.id))];
  const [teamRows, mates] = await Promise.all([
    selectInChunks(teamIds, (ids) =>
      db
        .select({ id: sessionTeams.id, name: sessionTeams.name })
        .from(sessionTeams)
        .where(inArray(sessionTeams.id, ids)),
    ),
    selectInChunks(visitIds, (ids) =>
      db
        .select({
          visitId: visitTeammates.visitId,
          id: users.id,
          name: users.name,
          image: users.image,
        })
        .from(visitTeammates)
        .innerJoin(users, eq(users.id, visitTeammates.userId))
        .where(inArray(visitTeammates.visitId, ids))
        .orderBy(asc(users.name), asc(users.id)),
    ),
  ]);

  const namesById = new Map(teamRows.map((team) => [team.id, team.name]));
  const matesByVisit = new Map<string, PersonRow[]>();
  for (const { visitId, ...person } of mates) {
    appendTo(matesByVisit, visitId, person);
  }

  return rows.map((row) => ({
    ...row,
    team:
      row.teamId === null
        ? null
        : {
            id: row.teamId,
            name: getOrThrow(namesById, row.teamId, "the visit's team"),
            members: matesByVisit.get(row.id) ?? [],
          },
  }));
}
