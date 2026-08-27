import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import type { InterestLevel, Religion } from "@/db/schema";
import { blocks, households, outingSessions, users, visits } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import type { BlockRow } from "@/server/blocks/service";
import type { SessionRow } from "@/server/sessions/service";
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
  const conditions = [
    ...(filters.memberId === undefined ? [] : [eq(visits.memberId, filters.memberId)]),
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

  const rows = await db
    .select({
      visitId: visits.id,
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

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(filter);

  return {
    rows: rows.map((row) => ({
      visit: {
        id: row.visitId,
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
