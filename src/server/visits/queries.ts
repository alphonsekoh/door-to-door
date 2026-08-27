import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { blocks, followUps, households, users, visits } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import { NotFoundError } from "@/server/http/errors";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";

/* Reads over households and their accumulated history. */

const visitColumns = {
  id: visits.id,
  householdId: visits.householdId,
  sessionId: visits.sessionId,
  interestLevel: visits.interestLevel,
  description: visits.description,
  clientCreatedAt: visits.clientCreatedAt,
  createdAt: visits.createdAt,
  updatedAt: visits.updatedAt,
  memberId: users.id,
  memberName: users.name,
  memberImage: users.image,
};

export type FollowUpRow = {
  id: string;
  householdId: string;
  visitId: string | null;
  note: string;
  dueDate: Date | null;
  doneAt: Date | null;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  doneById: string | null;
  doneByName: string | null;
  doneByImage: string | null;
};

export type HouseholdSummaryRow = {
  household: HouseholdRow;
  visitCount: number;
  outstandingFollowUps: number;
  latestVisit: VisitRow | null;
};

/*
 * Four queries regardless of page size: the page of households, their visits,
 * and their outstanding follow-up counts, plus the total. Summarising each
 * household with its own round trip would be N+1 on a block with a hundred
 * units, which is the normal case.
 */
export async function listHouseholds(
  db: Database,
  options: { blockId: string; sessionId?: string | undefined; limit: number; offset: number },
): Promise<{ rows: HouseholdSummaryRow[]; total: number }> {
  const blockExists = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(eq(blocks.id, options.blockId))
    .limit(1);

  if (blockExists.length === 0) {
    throw new NotFoundError("No such block.");
  }

  /*
   * Scoped to a session, only units recorded during it are listed: the block
   * unit list shows tonight's work, not every household ever known there.
   */
  const filter =
    options.sessionId === undefined
      ? eq(households.blockId, options.blockId)
      : and(
          eq(households.blockId, options.blockId),
          sql`exists (select 1 from ${visits} v where v.household_id = ${households.id} and v.session_id = ${options.sessionId})`,
        );

  const page = await db
    .select()
    .from(households)
    .where(filter)
    .orderBy(asc(households.unitNumber))
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(households)
    .where(filter);

  const total = firstOrThrow(counted, "the household count").total;
  if (page.length === 0) {
    return { rows: [], total };
  }

  const ids = page.map((household) => household.id);
  const history = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(
      options.sessionId === undefined
        ? inArray(visits.householdId, ids)
        : and(inArray(visits.householdId, ids), eq(visits.sessionId, options.sessionId)),
    )
    .orderBy(desc(visits.createdAt));

  const outstanding = await db
    .select({ householdId: followUps.householdId, total: sql<number>`count(*)::int` })
    .from(followUps)
    .where(and(inArray(followUps.householdId, ids), isNull(followUps.doneAt)))
    .groupBy(followUps.householdId);

  const outstandingByHousehold = new Map(outstanding.map((row) => [row.householdId, row.total]));
  const visitsByHousehold = new Map<string, VisitRow[]>();
  for (const visit of history) {
    visitsByHousehold.set(visit.householdId, [
      ...(visitsByHousehold.get(visit.householdId) ?? []),
      visit,
    ]);
  }

  return {
    rows: page.map((household) => {
      const theirs = visitsByHousehold.get(household.id) ?? [];
      return {
        household,
        visitCount: theirs.length,
        latestVisit: theirs[0] ?? null,
        outstandingFollowUps: outstandingByHousehold.get(household.id) ?? 0,
      };
    }),
    total,
  };
}

export type HouseholdHistoryRows = {
  household: HouseholdRow;
  block: { id: string; name: string; street: string; postalCode: string | null; createdAt: Date };
  visits: VisitRow[];
  followUps: FollowUpRow[];
};

export async function getHouseholdHistory(
  db: Database,
  householdId: string,
): Promise<HouseholdHistoryRows> {
  const found = await db
    .select({ household: households, block: blocks })
    .from(households)
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .where(eq(households.id, householdId))
    .limit(1);

  const row = found[0];
  if (!row) {
    throw new NotFoundError("No such household.");
  }

  /* Oldest first, so the interest trajectory reads left to right. */
  const history = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(eq(visits.householdId, householdId))
    .orderBy(asc(visits.createdAt));

  return {
    household: row.household,
    block: row.block,
    visits: history,
    followUps: await listFollowUpsFor(db, householdId),
  };
}

export async function listFollowUpsFor(db: Database, householdId: string): Promise<FollowUpRow[]> {
  /* Aliased so author and resolver can both be joined from the users table. */
  const author = alias(users, "author");
  const resolver = alias(users, "resolver");

  return db
    .select({
      id: followUps.id,
      householdId: followUps.householdId,
      visitId: followUps.visitId,
      note: followUps.note,
      dueDate: followUps.dueDate,
      doneAt: followUps.doneAt,
      createdAt: followUps.createdAt,
      authorId: author.id,
      authorName: author.name,
      authorImage: author.image,
      doneById: resolver.id,
      doneByName: resolver.name,
      doneByImage: resolver.image,
    })
    .from(followUps)
    .innerJoin(author, eq(author.id, followUps.authorId))
    .leftJoin(resolver, eq(resolver.id, followUps.doneBy))
    .where(eq(followUps.householdId, householdId))
    .orderBy(asc(followUps.createdAt));
}
