import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { blocks, households, users, visits } from "@/db/schema";
import type { BlockRow } from "@/server/blocks/service";
import {
  byBlockThenUnit,
  byNoteOwedThenResolved,
  onRevisitList,
  type RevisitSession,
} from "@/server/follow-ups/list-rule";
import { attachTeams } from "@/server/teams/access";
import { type FollowUpRow, selectFollowUps } from "@/server/visits/queries";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";
import { visitColumns } from "@/server/visits/service";

export type RevisitRow = {
  household: HouseholdRow;
  block: BlockRow;
  notes: FollowUpRow[];
  latestVisit: VisitRow | null;
  visitedInSession: boolean;
};

/*
 * The households a follow-up session goes back to, by block then unit. A
 * fixed number of queries however long the list: its notes, their households
 * and blocks, the latest visit at each (plus two to attach teams) and which
 * were visited in this session (D-20-3).
 */
export async function listRevisits(db: Database, session: RevisitSession): Promise<RevisitRow[]> {
  const notes = await selectFollowUps(db)
    .where(onRevisitList(db, session))
    .orderBy(...byNoteOwedThenResolved);

  if (notes.length === 0) {
    return [];
  }
  const ids = [...new Set(notes.map((note) => note.householdId))];

  const places = await db
    .select({ household: households, block: blocks })
    .from(households)
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .where(inArray(households.id, ids))
    .orderBy(...byBlockThenUnit);

  const latest = await attachTeams(
    db,
    await db
      .selectDistinctOn([visits.householdId], visitColumns)
      .from(visits)
      .innerJoin(users, eq(users.id, visits.memberId))
      .where(inArray(visits.householdId, ids))
      .orderBy(visits.householdId, desc(visits.createdAt)),
  );

  const visited = await db
    .selectDistinct({ householdId: visits.householdId })
    .from(visits)
    .where(and(eq(visits.sessionId, session.id), inArray(visits.householdId, ids)));

  const latestByHousehold = new Map(latest.map((visit) => [visit.householdId, visit]));
  const visitedIds = new Set(visited.map((row) => row.householdId));

  return places.map(({ household, block }) => ({
    household,
    block,
    notes: notes.filter((note) => note.householdId === household.id),
    latestVisit: latestByHousehold.get(household.id) ?? null,
    visitedInSession: visitedIds.has(household.id),
  }));
}
