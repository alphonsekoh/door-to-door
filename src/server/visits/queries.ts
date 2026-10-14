import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { blocks, followUps, households, users, visits } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import { NotFoundError } from "@/server/http/errors";
import { attachTeams } from "@/server/teams/access";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";
import { visitColumns } from "@/server/visits/service";

/* Reads over households and their accumulated history. */

export type FollowUpRow = {
  id: string;
  householdId: string;
  blockName: string;
  unitNumber: string;
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
 * A fixed number of queries regardless of page size: the page of households,
 * their visits, their outstanding follow-up counts, the total, and two to
 * attach teams (none when no visit is stamped). Summarising each
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
  const rawHistory = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(
      options.sessionId === undefined
        ? inArray(visits.householdId, ids)
        : and(inArray(visits.householdId, ids), eq(visits.sessionId, options.sessionId)),
    )
    .orderBy(desc(visits.createdAt));

  const history = await attachTeams(db, rawHistory);

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
  const history = await attachTeams(
    db,
    await db
      .select(visitColumns)
      .from(visits)
      .innerJoin(users, eq(users.id, visits.memberId))
      .where(eq(visits.householdId, householdId))
      .orderBy(asc(visits.createdAt)),
  );

  return {
    household: row.household,
    block: row.block,
    visits: history,
    followUps: await listFollowUpsFor(db, householdId),
  };
}

/* Aliased so author and resolver can both be joined from the users table. */
const author = alias(users, "author");
const resolver = alias(users, "resolver");

/*
 * The one SELECT every follow-up read goes through, so the list, a single
 * note and a household's history can never disagree on what a note carries.
 * Callers add their own filter and order.
 */
export function selectFollowUps(db: Database) {
  return db
    .select({
      id: followUps.id,
      householdId: followUps.householdId,
      blockName: blocks.name,
      unitNumber: households.unitNumber,
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
    .innerJoin(households, eq(households.id, followUps.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .innerJoin(author, eq(author.id, followUps.authorId))
    .leftJoin(resolver, eq(resolver.id, followUps.doneBy));
}

export async function listFollowUpsFor(db: Database, householdId: string): Promise<FollowUpRow[]> {
  return selectFollowUps(db)
    .where(eq(followUps.householdId, householdId))
    .orderBy(asc(followUps.createdAt));
}

export type HouseholdAttentionRow = {
  household: HouseholdRow;
  block: {
    id: string;
    name: string;
    street: string;
    postalCode: string | null;
    createdAt: Date;
  };
  latestVisit: VisitRow;
  visitCount: number;
  lastVisitedAt: Date;
};

/* medium counts as interest; low and no_response do not. */
const AT_LEAST: Record<"medium" | "high", ("medium" | "high")[]> = {
  medium: ["medium", "high"],
  high: ["high"],
};

/*
 * Doors that said yes and were never gone back to.
 *
 * "Most recent visit" is the whole point: a unit that was high in March and
 * declined in June is not on this list, because the last thing it said is what
 * matters. Comparing against max(created_at) rather than picking any matching
 * visit is what makes that true.
 *
 * A household with an outstanding follow-up is excluded - it is already
 * someone's job, and leaving it here would make the list something to scroll
 * past rather than work through.
 */
export async function listHouseholdsNeedingAttention(
  db: Database,
  options: {
    minimumInterest: "medium" | "high";
    blockId?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<{ rows: HouseholdAttentionRow[]; total: number }> {
  const latest = sql`${visits.createdAt} = (
    select max(v2.created_at) from ${visits} v2 where v2.household_id = ${visits.householdId}
  )`;
  const noOutstanding = sql`not exists (
    select 1 from ${followUps} f
    where f.household_id = ${visits.householdId} and f.done_at is null
  )`;

  const conditions = [
    latest,
    noOutstanding,
    inArray(visits.interestLevel, AT_LEAST[options.minimumInterest]),
    ...(options.blockId === undefined ? [] : [eq(households.blockId, options.blockId)]),
  ];
  const filter = and(...conditions);

  const found = await db
    .select({
      ...visitColumns,
      household: households,
      block: blocks,
      visitCount: sql<number>`(
        select count(*)::int from ${visits} v3 where v3.household_id = ${visits.householdId}
      )`,
    })
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .innerJoin(households, eq(households.id, visits.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .where(filter)
    /* Oldest first: the longer a yes has been left, the more it has cost. */
    .orderBy(asc(visits.createdAt))
    .limit(options.limit)
    .offset(options.offset);

  const rows = await attachTeams(db, found);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(filter);

  return {
    rows: rows.map((row) => ({
      household: row.household,
      block: row.block,
      latestVisit: {
        id: row.id,
        householdId: row.householdId,
        sessionId: row.sessionId,
        teamId: row.teamId,
        team: row.team,
        interestLevel: row.interestLevel,
        description: row.description,
        clientCreatedAt: row.clientCreatedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        memberId: row.memberId,
        memberName: row.memberName,
        memberImage: row.memberImage,
      },
      visitCount: row.visitCount,
      lastVisitedAt: row.createdAt,
    })),
    total: firstOrThrow(counted, "the attention count").total,
  };
}
