import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { followUps } from "@/db/schema";
import { liveFollowUp, onRevisitList, type RevisitSession } from "@/server/follow-ups/list-rule";

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
    .where(
      and(
        eq(followUps.householdId, householdId),
        isNull(followUps.doneAt),
        onRevisitList(tx, session),
      ),
    );
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
