import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { followUps } from "@/db/schema";
import { appendTo, presentOrThrow } from "@/server/db-utils";
import { liveFollowUp, onRevisitList, type RevisitSession } from "@/server/follow-ups/list-rule";

/* What a new visit there marks: the notes on the session's list still owed. */
const owedOnList = (tx: Database, session: RevisitSession) =>
  and(isNull(followUps.doneAt), onRevisitList(tx, session));

/*
 * In a follow-up session the visit is what the household's notes asked for,
 * so recording one there marks every note still owed on the session's list
 * done (owner), credited to the visit's author.
 *
 * Called inside the visit's transaction, and only by the call that inserted
 * the visit, so a replay, an amend or a duplicate id marks nothing. By then
 * the session row is held (FOR KEY SHARE) and the household row by its
 * upsert, so the notes are locked last, in the order every note write takes
 * (D-117-45, D-117-9). Only notes still owed are touched: one marked done by
 * hand meanwhile keeps whoever did it (D-35-8).
 */
export async function markDoneByVisit(
  tx: Database,
  session: RevisitSession,
  householdId: string,
  visitId: string,
  authorId: string,
): Promise<void> {
  if (session.kind !== "follow_up") {
    return;
  }
  const now = new Date();
  await tx
    .update(followUps)
    .set({ doneAt: now, doneBy: authorId, doneVisitId: visitId, updatedAt: now })
    .where(and(eq(followUps.householdId, householdId), owedOnList(tx, session)));
}

/*
 * markDoneByVisit for a run of new visits by one author, in one statement.
 * Each household's owed notes go to the first of the run's visits there, as
 * recording them one at a time would have left them: by the second, the
 * first had marked them all (D-251-8).
 */
export async function markDoneByVisits(
  tx: Database,
  session: RevisitSession,
  recorded: readonly { householdId: string; visitId: string }[],
  authorId: string,
): Promise<void> {
  if (session.kind !== "follow_up") {
    return;
  }
  const firstAt = new Map<string, string>();
  for (const { householdId, visitId } of recorded) {
    if (!firstAt.has(householdId)) firstAt.set(householdId, visitId);
  }
  const visitAt = sql.join(
    [...firstAt].map(
      ([householdId, visitId]) => sql`when ${householdId}::uuid then ${visitId}::uuid`,
    ),
    sql` `,
  );
  const now = new Date();
  await tx
    .update(followUps)
    .set({
      doneAt: now,
      doneBy: authorId,
      doneVisitId: sql`case ${followUps.householdId} ${visitAt} end`,
      updatedAt: now,
    })
    .where(and(inArray(followUps.householdId, [...firstAt.keys()]), owedOnList(tx, session)));
}

/*
 * What recording a visit marked done and is still done, read from what is
 * stored: a replay, or a client whose answer was lost, is told the same
 * notes, and a note reopened since (which clears the link) is not named.
 */
export async function notesMarkedDoneBy(db: Database, visitId: string): Promise<string[]> {
  const rows = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(and(eq(followUps.doneVisitId, visitId), liveFollowUp))
    .orderBy(asc(followUps.createdAt), asc(followUps.id));
  return rows.map((row) => row.id);
}

/* notesMarkedDoneBy for many visits at once, keyed by visit id in lower case. */
export async function notesMarkedDoneByVisits(
  db: Database,
  visitIds: readonly string[],
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ id: followUps.id, visitId: followUps.doneVisitId })
    .from(followUps)
    .where(and(inArray(followUps.doneVisitId, [...visitIds]), liveFollowUp))
    .orderBy(asc(followUps.createdAt), asc(followUps.id));
  const byVisit = new Map<string, string[]>();
  for (const row of rows) {
    appendTo(byVisit, presentOrThrow(row.visitId, "the marking visit"), row.id);
  }
  return byVisit;
}
