import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import type { InterestLevel, Religion } from "@/db/schema";
import { blocks, households, outingSessions, sessionTeamMembers, users, visits } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import type { BlockRow } from "@/server/blocks/service";
import type { SessionRow } from "@/server/sessions/service";
import { attachTeams } from "@/server/teams/access";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";

/*
 * Historical records across every session.
 *
 * One query shape serves both the admin view and a member's own records; the
 * difference is a memberId the caller cannot choose for themselves. Keeping it
 * to one shape means the two views cannot drift into disagreeing about what a
 * record looks like.
 */

export type HistoryEntryRow = {
  visit: VisitRow;
  household: HouseholdRow;
  block: BlockRow;
  session: SessionRow;
};

const sessionCreator = alias(users, "session_creator");

export type HistoryFilters = {
  memberId?: string | undefined;
  /*
   * With memberId, also matches records stamped with a team this user is on
   * RIGHT NOW. The id is the viewer's own, taken from the session by the
   * handler - never a request parameter.
   */
  includeTeamOf?: string | undefined;
  teamId?: string | undefined;
  blockId?: string | undefined;
  sessionId?: string | undefined;
  interestLevel?: InterestLevel | undefined;
  religion?: Religion | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export async function listHistory(
  db: Database,
  filters: HistoryFilters & { limit: number; offset: number },
): Promise<{ rows: HistoryEntryRow[]; total: number }> {
  const teamsOfViewer = (userId: string) =>
    inArray(
      visits.teamId,
      db
        .select({ teamId: sessionTeamMembers.teamId })
        .from(sessionTeamMembers)
        .where(eq(sessionTeamMembers.userId, userId)),
    );
  const memberScope =
    filters.memberId === undefined
      ? []
      : [
          filters.includeTeamOf === undefined
            ? eq(visits.memberId, filters.memberId)
            : or(eq(visits.memberId, filters.memberId), teamsOfViewer(filters.includeTeamOf)),
        ];

  const conditions = [
    ...memberScope,
    ...(filters.teamId === undefined ? [] : [eq(visits.teamId, filters.teamId)]),
    ...(filters.blockId === undefined ? [] : [eq(households.blockId, filters.blockId)]),
    ...(filters.sessionId === undefined ? [] : [eq(visits.sessionId, filters.sessionId)]),
    ...(filters.interestLevel === undefined
      ? []
      : [eq(visits.interestLevel, filters.interestLevel)]),
    ...(filters.religion === undefined ? [] : [eq(households.religion, filters.religion)]),
    ...(filters.from === undefined ? [] : [gte(visits.createdAt, new Date(filters.from))]),
    ...(filters.to === undefined ? [] : [lte(visits.createdAt, new Date(filters.to))]),
  ];
  /* Filters compose: every supplied one narrows the same set. */
  const filter = conditions.length > 0 ? and(...conditions) : undefined;

  const found = await db
    .select({
      id: visits.id,
      teamId: visits.teamId,
      visitHouseholdId: visits.householdId,
      visitSessionId: visits.sessionId,
      interestLevel: visits.interestLevel,
      description: visits.description,
      clientCreatedAt: visits.clientCreatedAt,
      visitCreatedAt: visits.createdAt,
      visitUpdatedAt: visits.updatedAt,
      memberId: users.id,
      memberName: users.name,
      memberImage: users.image,
      household: households,
      block: blocks,
      sessionId: outingSessions.id,
      sessionTitle: outingSessions.title,
      sessionKind: outingSessions.kind,
      sessionStatus: outingSessions.status,
      sessionStartedAt: outingSessions.startedAt,
      sessionEndedAt: outingSessions.endedAt,
      sessionCreatedAt: outingSessions.createdAt,
      sessionCreatedBy: sessionCreator.id,
      sessionCreatedByName: sessionCreator.name,
      sessionCreatedByImage: sessionCreator.image,
    })
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .innerJoin(households, eq(households.id, visits.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .innerJoin(outingSessions, eq(outingSessions.id, visits.sessionId))
    /*
     * Aliased so the session's creator can be joined alongside the visit's
     * member. Fetching creators separately needed a fallback for a user who
     * cannot be missing - createdBy has a restrict foreign key - and an
     * unreachable branch is worse than an extra join.
     */
    .innerJoin(sessionCreator, eq(sessionCreator.id, outingSessions.createdBy))
    .where(filter)
    .orderBy(desc(visits.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  const rows = await attachTeams(db, found);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(filter);

  return {
    rows: rows.map((row) => ({
      visit: {
        id: row.id,
        teamId: row.teamId,
        team: row.team,
        householdId: row.visitHouseholdId,
        sessionId: row.visitSessionId,
        interestLevel: row.interestLevel,
        description: row.description,
        clientCreatedAt: row.clientCreatedAt,
        createdAt: row.visitCreatedAt,
        updatedAt: row.visitUpdatedAt,
        memberId: row.memberId,
        memberName: row.memberName,
        memberImage: row.memberImage,
      },
      household: row.household,
      block: row.block,
      session: {
        id: row.sessionId,
        title: row.sessionTitle,
        kind: row.sessionKind,
        status: row.sessionStatus,
        startedAt: row.sessionStartedAt,
        endedAt: row.sessionEndedAt,
        createdAt: row.sessionCreatedAt,
        createdById: row.sessionCreatedBy,
        createdByName: row.sessionCreatedByName,
        createdByImage: row.sessionCreatedByImage,
      },
    })),
    total: firstOrThrow(counted, "the history count").total,
  };
}

export type SessionHistoryRow = {
  session: SessionRow;
  blocks: BlockRow[];
  visitCount: number;
  householdCount: number;
  interest: { low: number; medium: number; high: number; noResponse: number };
  firstRecordedAt: Date;
  lastRecordedAt: Date;
};

const countWhere = (level: InterestLevel) =>
  sql<number>`count(*) filter (where ${visits.interestLevel} = ${level})::int`;

/*
 * The outings a member worked, newest first.
 *
 * Three queries regardless of page size: the aggregated sessions, the blocks
 * those sessions touched, and the total. Counting a session's blocks with a
 * query each would be N+1 over a member's whole history, which only grows.
 *
 * Every count here is the member's own. Two members on the same block see
 * different numbers, which is the point - this answers "what did I do", not
 * "how did the outing go".
 */
export async function listOwnSessionHistory(
  db: Database,
  options: { memberId: string; limit: number; offset: number },
): Promise<{ rows: SessionHistoryRow[]; total: number }> {
  const mine = eq(visits.memberId, options.memberId);

  const summaries = await db
    .select({
      sessionId: outingSessions.id,
      sessionTitle: outingSessions.title,
      sessionKind: outingSessions.kind,
      sessionStatus: outingSessions.status,
      sessionStartedAt: outingSessions.startedAt,
      sessionEndedAt: outingSessions.endedAt,
      sessionCreatedAt: outingSessions.createdAt,
      sessionCreatedBy: sessionCreator.id,
      sessionCreatedByName: sessionCreator.name,
      sessionCreatedByImage: sessionCreator.image,
      visitCount: sql<number>`count(*)::int`,
      householdCount: sql<number>`count(distinct ${visits.householdId})::int`,
      low: countWhere("low"),
      medium: countWhere("medium"),
      high: countWhere("high"),
      noResponse: countWhere("no_response"),
      /* mapWith, because a bare sql`` has no column mapper: Drizzle asks the
         driver for timestamps as strings and converts them per column, so an
         aggregate over one comes back as text unless it is told otherwise. */
      firstRecordedAt: sql`min(${visits.createdAt})`.mapWith(visits.createdAt),
      lastRecordedAt: sql`max(${visits.createdAt})`.mapWith(visits.createdAt),
    })
    .from(visits)
    .innerJoin(outingSessions, eq(outingSessions.id, visits.sessionId))
    .innerJoin(sessionCreator, eq(sessionCreator.id, outingSessions.createdBy))
    .where(mine)
    .groupBy(outingSessions.id, sessionCreator.id)
    /* By the member's own last record, not the session's dates: a draft or
       reopened outing has no useful startedAt to sort on. */
    .orderBy(desc(sql`max(${visits.createdAt})`))
    .limit(options.limit)
    .offset(options.offset);

  const sessionIds = summaries.map((row) => row.sessionId);

  const blockRows =
    sessionIds.length === 0
      ? []
      : await db
          .selectDistinct({ sessionId: visits.sessionId, block: blocks })
          .from(visits)
          .innerJoin(households, eq(households.id, visits.householdId))
          .innerJoin(blocks, eq(blocks.id, households.blockId))
          .where(and(mine, inArray(visits.sessionId, sessionIds)))
          .orderBy(blocks.name);

  const counted = await db
    .select({ total: sql<number>`count(distinct ${visits.sessionId})::int` })
    .from(visits)
    .where(mine);

  return {
    rows: summaries.map((row) => ({
      session: {
        id: row.sessionId,
        title: row.sessionTitle,
        kind: row.sessionKind,
        status: row.sessionStatus,
        startedAt: row.sessionStartedAt,
        endedAt: row.sessionEndedAt,
        createdAt: row.sessionCreatedAt,
        createdById: row.sessionCreatedBy,
        createdByName: row.sessionCreatedByName,
        createdByImage: row.sessionCreatedByImage,
      },
      /* Scanned rather than grouped into a map: a page holds at most a
         hundred outings and their blocks, and a lookup with a fallback would
         carry a branch no query can reach. */
      blocks: blockRows.filter((b) => b.sessionId === row.sessionId).map((b) => b.block),
      visitCount: row.visitCount,
      householdCount: row.householdCount,
      interest: {
        low: row.low,
        medium: row.medium,
        high: row.high,
        noResponse: row.noResponse,
      },
      firstRecordedAt: row.firstRecordedAt,
      lastRecordedAt: row.lastRecordedAt,
    })),
    total: firstOrThrow(counted, "the session history count").total,
  };
}
