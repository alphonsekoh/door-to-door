import { and, eq, gte, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role, SessionKind } from "@/db/schema";
import { followUps, households, outingSessions, sessionBlocks } from "@/db/schema";
import { ConflictError } from "@/server/http/errors";

/*
 * A follow-up session's list: where a member may record in that session, and
 * what the session screen shows them. One rule, written once, behind the
 * revisits endpoint, the recording refusal and a member's right to change a
 * listed note, so the list and its refusals cannot disagree.
 *
 * Kept apart from revisits.ts, which reads visits, so the visit service can
 * use the rule without importing itself back.
 */

/* A note nobody has removed. Removal is soft, so every ordinary read needs it. */
export const liveFollowUp = isNull(followUps.deletedAt);

export type RevisitSession = { id: string; kind: SessionKind; startedAt: Date | null };

/*
 * Listed, not removed, still owed or resolved since the session started, and
 * in one of the session's blocks. A draft has no start, so only what is still
 * owed counts: a note resolved last month is not tonight's work.
 */
export function onRevisitList(db: Database, session: RevisitSession): SQL | undefined {
  return and(
    eq(followUps.status, "listed"),
    liveFollowUp,
    session.startedAt === null
      ? isNull(followUps.doneAt)
      : or(isNull(followUps.doneAt), gte(followUps.doneAt, session.startedAt)),
    inArray(
      followUps.householdId,
      db
        .select({ id: households.id })
        .from(households)
        .innerJoin(sessionBlocks, eq(sessionBlocks.blockId, households.blockId))
        .where(eq(sessionBlocks.sessionId, session.id)),
    ),
  );
}

/* Matched on the trimmed unit, exactly as recording upserts the household. */
export async function isUnitOnRevisitList(
  db: Database,
  session: RevisitSession,
  blockId: string,
  unitNumber: string,
): Promise<boolean> {
  const found = await db
    .select({ id: followUps.id })
    .from(followUps)
    .innerJoin(households, eq(households.id, followUps.householdId))
    .where(
      and(
        eq(households.blockId, blockId),
        eq(households.unitNumber, unitNumber.trim()),
        onRevisitList(db, session),
      ),
    )
    .limit(1);
  return found.length > 0;
}

/*
 * Whether a note is on the list of the follow-up session running now. Two
 * queries, so the rule is the list's own SQL rather than a copy of it joined
 * to the session table.
 */
export async function isNoteOnActiveRevisitList(db: Database, noteId: string): Promise<boolean> {
  const active = await db
    .select({
      id: outingSessions.id,
      kind: outingSessions.kind,
      startedAt: outingSessions.startedAt,
    })
    .from(outingSessions)
    .where(and(eq(outingSessions.status, "active"), eq(outingSessions.kind, "follow_up")))
    .limit(1);

  const session = active[0];
  if (!session) {
    return false;
  }
  const found = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(and(eq(followUps.id, noteId), onRevisitList(db, session)))
    .limit(1);
  return found.length > 0;
}

/*
 * In a follow-up session a member records only at listed households. The
 * caller's role decides, not the author's: an admin recording on a member's
 * behalf is exempt, as the admin is the one choosing to record there.
 */
export async function assertMayRecordHere(
  db: Database,
  actor: { role: Role },
  session: RevisitSession,
  blockId: string,
  unitNumber: string,
): Promise<void> {
  if (actor.role === "admin" || session.kind !== "follow_up") {
    return;
  }
  if (!(await isUnitOnRevisitList(db, session, blockId, unitNumber))) {
    throw new ConflictError(
      "not_on_follow_up_list",
      "This unit is not on the follow-up list for this session. Ask an admin to add it.",
    );
  }
}
