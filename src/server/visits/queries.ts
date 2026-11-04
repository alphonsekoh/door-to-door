import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { blocks, followUps, households, users, visits, type FollowUpStatus } from "@/db/schema";
import { firstOrThrow, getOrThrow } from "@/server/db-utils";
import { liveFollowUp } from "@/server/follow-ups/list-rule";
import { NotFoundError } from "@/server/http/errors";
import { attachTeams } from "@/server/teams/access";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";
import { visitColumns } from "@/server/visits/service";

/* Reads over households and their accumulated history. */

export type FollowUpRow = {
  id: string;
  householdId: string;
  blockId: string;
  blockName: string;
  unitNumber: string;
  visitId: string | null;
  status: FollowUpStatus;
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
  listedAt: Date | null;
  listedById: string | null;
  listedByName: string | null;
  listedByImage: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedByName: string | null;
  deletedByImage: string | null;
  deleteReason: string | null;
  waitingSuggestionId: string | null;
  waitingById: string | null;
  waitingByName: string | null;
  waitingByImage: string | null;
};

export type HouseholdSummaryRow = {
  household: HouseholdRow;
  visitCount: number;
  outstandingFollowUps: number;
  latestVisit: VisitRow | null;
};

/*
 * A fixed number of queries regardless of page size (D-20-3): the page of
 * households, the total, each one's visit count and latest visit, those
 * visits, their outstanding follow-up counts, and two to attach teams (none
 * when no visit is stamped). Summarising each household with its own round
 * trip would be N+1 on a block with a hundred units, which is the normal case.
 *
 * Only the page's summaries and at most one visit per household reach Node,
 * however many visits a household has (D-126-1).
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
    .select({ id: households.id })
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
  const inSession =
    options.sessionId === undefined ? undefined : eq(visits.sessionId, options.sessionId);

  /*
   * Summarised in their own query, by id, rather than in the page's: there
   * OFFSET would have Postgres work them out for every row it skips. Lateral
   * subqueries built by Drizzle, not scalar ones in raw SQL, where it would
   * leave the outer column unqualified (R-7). A count always has a row.
   */
  const tally = db
    .select({ visitCount: sql<number>`count(*)::int`.as("visit_count") })
    .from(visits)
    .where(and(eq(visits.householdId, households.id), inSession))
    .as("tally");
  /* Newest first, the id breaking a tie, as the history's last visit (getHouseholdHistory). */
  const latest = db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.householdId, households.id), inSession))
    .orderBy(desc(visits.createdAt), desc(visits.id))
    .limit(1)
    .as("latest");

  const summaries = await db
    .select({ household: households, visitCount: tally.visitCount, latestId: latest.id })
    .from(households)
    .crossJoinLateral(tally)
    .leftJoinLateral(latest, sql`true`)
    .where(inArray(households.id, ids))
    .orderBy(asc(households.unitNumber));

  const latestIds = summaries.flatMap((row) => (row.latestId === null ? [] : [row.latestId]));
  const latestVisits = await attachTeams(
    db,
    await db
      .select(visitColumns)
      .from(visits)
      .innerJoin(users, eq(users.id, visits.memberId))
      .where(inArray(visits.id, latestIds)),
  );

  /* Only what is owed: a suggestion is not a promise until an admin lists it. */
  const outstanding = await db
    .select({ householdId: followUps.householdId, total: sql<number>`count(*)::int` })
    .from(followUps)
    .where(
      and(
        inArray(followUps.householdId, ids),
        liveFollowUp,
        eq(followUps.status, "listed"),
        isNull(followUps.doneAt),
      ),
    )
    .groupBy(followUps.householdId);

  const outstandingByHousehold = new Map(outstanding.map((row) => [row.householdId, row.total]));
  const visitsById = new Map(latestVisits.map((visit) => [visit.id, visit]));

  return {
    rows: summaries.map((row) => ({
      household: row.household,
      visitCount: row.visitCount,
      latestVisit:
        row.latestId === null ? null : getOrThrow(visitsById, row.latestId, "the latest visit"),
      outstandingFollowUps: outstandingByHousehold.get(row.household.id) ?? 0,
    })),
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
      .orderBy(asc(visits.createdAt), asc(visits.id)),
  );

  return {
    household: row.household,
    block: row.block,
    visits: history,
    followUps: await listFollowUpsFor(db, householdId),
  };
}

/* Aliased so everyone a note names can be joined from the users table. */
const author = alias(users, "author");
const resolver = alias(users, "resolver");
const lister = alias(users, "lister");
const remover = alias(users, "remover");
/* A suggestion waiting at the same door, and who made it. */
const pending = alias(followUps, "pending");
const suggester = alias(users, "suggester");

/*
 * The one SELECT every follow-up read goes through, so the list, a single
 * note and a household's history can never disagree on what a note carries.
 * Callers add their own filter and order, including whether removed notes
 * count (`liveFollowUp`).
 *
 * A listed, live note also carries the suggestion waiting at its household,
 * if any, since reopening it would leave that suggestion beside an owed note.
 * The partial unique index allows at most one, so the join never doubles a
 * row; a suggestion or a removed note joins none.
 */
export function selectFollowUps(db: Database) {
  return db
    .select({
      id: followUps.id,
      householdId: followUps.householdId,
      blockId: households.blockId,
      blockName: blocks.name,
      unitNumber: households.unitNumber,
      visitId: followUps.visitId,
      status: followUps.status,
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
      listedAt: followUps.listedAt,
      listedById: lister.id,
      listedByName: lister.name,
      listedByImage: lister.image,
      deletedAt: followUps.deletedAt,
      deletedById: remover.id,
      deletedByName: remover.name,
      deletedByImage: remover.image,
      deleteReason: followUps.deleteReason,
      waitingSuggestionId: pending.id,
      waitingById: suggester.id,
      waitingByName: suggester.name,
      waitingByImage: suggester.image,
    })
    .from(followUps)
    .innerJoin(households, eq(households.id, followUps.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .innerJoin(author, eq(author.id, followUps.authorId))
    .leftJoin(resolver, eq(resolver.id, followUps.doneBy))
    .leftJoin(lister, eq(lister.id, followUps.listedBy))
    .leftJoin(remover, eq(remover.id, followUps.deletedBy))
    .leftJoin(
      pending,
      and(
        eq(followUps.status, "listed"),
        isNull(followUps.deletedAt),
        eq(pending.householdId, followUps.householdId),
        eq(pending.status, "suggested"),
        isNull(pending.deletedAt),
      ),
    )
    .leftJoin(suggester, eq(suggester.id, pending.authorId));
}

/* Listed notes and pending suggestions alike, so the next member sees both. */
export async function listFollowUpsFor(db: Database, householdId: string): Promise<FollowUpRow[]> {
  return selectFollowUps(db)
    .where(and(eq(followUps.householdId, householdId), liveFollowUp))
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
 * A household with an open follow-up is excluded - an unresolved listed note
 * is already someone's job, and a pending suggestion is already in the review
 * queue. Leaving either here would make the list something to scroll past
 * rather than work through. Removed notes do not count.
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
  const noOpenNote = sql`not exists (
    select 1 from ${followUps} f
    where f.household_id = ${visits.householdId}
      and f.deleted_at is null
      and (f.status = 'suggested' or f.done_at is null)
  )`;

  const conditions = [
    latest,
    noOpenNote,
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
