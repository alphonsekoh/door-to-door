import { and, asc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import type { SessionKind } from "@/db/schema";
import { blocks, followUps, households, outingSessions, sessionHouseholds } from "@/db/schema";

/*
 * A follow-up session's list: what the session screen shows, which
 * households' notes a visit marks done, and whether a member may change a
 * listed note. One rule, written once, behind the revisits endpoint, the
 * marking and that right, so they cannot disagree. It never decides where
 * a visit may be recorded (D-272-2).
 *
 * Kept apart from revisits.ts, which reads visits, so the visit service can
 * use the rule without importing itself back.
 */

/* A note nobody has removed. Removal is soft, so every ordinary read needs it. */
export const liveFollowUp = isNull(followUps.deletedAt);

export type RevisitSession = { id: string; kind: SessionKind; startedAt: Date | null };

/*
 * How the list and an admin's picks are read: by block, then unit. Only
 * (name, street) is unique, so the street keeps two blocks that share a name
 * apart, and a screen grouping neighbouring rows by block meets each once.
 */
export const byBlockThenUnit = [asc(blocks.name), asc(blocks.street), asc(households.unitNumber)];

/*
 * A household's notes on a session's list or picks: what is still owed, by
 * due day with undated last, then what was resolved, most recently first.
 * So the first note is the one the visit is for: the soonest owed, or, once
 * all are done, the one resolved last, never an old one resolved long ago.
 * The id settles a tie, so the first note is the same on every read.
 */
export const byNoteOwedThenResolved = [
  sql`${followUps.doneAt} desc nulls first`,
  asc(followUps.dueDate),
  asc(followUps.createdAt),
  asc(followUps.id),
];

/* The list's own notes, apart from whichever follow-ups a caller reads. */
const listed = alias(followUps, "listed_note");

/*
 * Picked for the session by an admin, and with a note that is listed, not
 * removed, and still owed or resolved since both the session started and the
 * household was picked. A note resolved before either was not this session's
 * work there: last month's, or one done before an admin added the door to a
 * running session for another note. A draft has no start, so only what is
 * still owed counts. A pick whose notes have all left the list stays picked,
 * and simply drops off the list until one is listed or reopened.
 *
 * The set of notes on the list, uncorrelated, so each note is held to its
 * own pick's time and never compared with a caller's same-named column.
 */
export function onRevisitList(db: Database, session: RevisitSession): SQL {
  const { startedAt } = session;
  return inArray(
    followUps.id,
    db
      .select({ id: listed.id })
      .from(listed)
      .innerJoin(
        sessionHouseholds,
        and(
          eq(sessionHouseholds.householdId, listed.householdId),
          eq(sessionHouseholds.sessionId, session.id),
        ),
      )
      .where(
        and(
          eq(listed.status, "listed"),
          isNull(listed.deletedAt),
          startedAt === null
            ? isNull(listed.doneAt)
            : or(
                isNull(listed.doneAt),
                and(gte(listed.doneAt, startedAt), gte(listed.doneAt, sessionHouseholds.addedAt)),
              ),
        ),
      ),
  );
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

/* A unit as households are keyed: its block in either letter case, and its unit as stored. */
export function placeKey(blockId: string, unitNumber: string): string {
  return `${blockId.toLowerCase()} ${unitNumber}`;
}
