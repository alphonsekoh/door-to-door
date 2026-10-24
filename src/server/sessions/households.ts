import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { SessionKind, SessionStatus } from "@/db/schema";
import {
  blocks,
  followUps,
  households,
  outingSessions,
  sessionBlocks,
  sessionHouseholds,
  visits,
} from "@/db/schema";
import type { BlockRow } from "@/server/blocks/service";
import { firstOrThrow } from "@/server/db-utils";
import {
  byBlockThenUnit,
  liveFollowUp,
  onRevisitList,
  type RevisitSession,
} from "@/server/follow-ups/list-rule";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import { type FollowUpRow, selectFollowUps } from "@/server/visits/queries";
import type { HouseholdRow } from "@/server/visits/service";

/*
 * The households an admin picks for a follow-up session, and the blocks that
 * follow them. A follow-up session's blocks are exactly its picks' blocks:
 * every add and remove keeps the two in step, so a member never opens an
 * empty block, and nobody attaches or detaches one by hand.
 *
 * Writes here lock the session row first (FOR UPDATE), then touch
 * households only through foreign keys. Recording a visit locks the same
 * session row first too (FOR KEY SHARE, which only these writes and a
 * transition conflict with), then the household, so the two always meet in
 * one order and never deadlock: a remove either waits for a visit and sees
 * it, or the visit waits and re-checks the session's blocks and list after
 * it. Follow-up writes lock the household and then the note, never a
 * session. The session lock is also what makes "never remove the last
 * household" hold when two admins remove the last two at once.
 */

export type LockedSession = RevisitSession & { status: SessionStatus };

export async function lockSession(tx: Database, id: string): Promise<LockedSession> {
  const found = await tx
    .select({
      id: outingSessions.id,
      kind: outingSessions.kind,
      status: outingSessions.status,
      startedAt: outingSessions.startedAt,
    })
    .from(outingSessions)
    .where(eq(outingSessions.id, id))
    .for("update");
  const session = found[0];
  if (!session) {
    throw new NotFoundError("No such session.");
  }
  return session;
}

/*
 * Whether visits were recorded in this block during this session. Shared
 * with detaching a block by hand, so neither path can orphan a member's work.
 */
export async function blockHasSessionVisits(
  db: Database,
  sessionId: string,
  blockId: string,
): Promise<boolean> {
  const recorded = await db
    .select({ id: visits.id })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(and(eq(visits.sessionId, sessionId), eq(households.blockId, blockId)))
    .limit(1);
  return recorded.length > 0;
}

/* What only a follow-up session has, refused for the other kind. */
export function assertFollowUpSession(session: { kind: SessionKind }): void {
  if (session.kind !== "follow_up") {
    throw new ConflictError("conflict", "This is a regular session, so it has no households.");
  }
}

/* Picks change while a session is prepared or running; an ended one's are its record. */
function assertPicksOpen(session: { kind: SessionKind; status: SessionStatus }): void {
  assertFollowUpSession(session);
  if (session.status === "ended") {
    throw new ConflictError(
      "conflict",
      "This session has ended, so its households can no longer change. Reopen it first.",
    );
  }
}

/*
 * Adds households to a session and their blocks to its blocks, all or
 * nothing: an unknown household is 404, and one with no listed, live,
 * outstanding note (a stale screen) is 409 before anything is written.
 * A household already picked is left as it is.
 */
export async function pickHouseholds(
  tx: Database,
  sessionId: string,
  householdIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(householdIds)];
  const found = await tx
    .select({ id: households.id, blockId: households.blockId })
    .from(households)
    .where(inArray(households.id, unique));
  if (found.length !== unique.length) {
    throw new NotFoundError("One or more of those households do not exist.");
  }

  const owed = await tx
    .selectDistinct({ householdId: followUps.householdId })
    .from(followUps)
    .where(
      and(
        inArray(followUps.householdId, unique),
        eq(followUps.status, "listed"),
        liveFollowUp,
        isNull(followUps.doneAt),
      ),
    );
  if (owed.length !== unique.length) {
    throw new ConflictError(
      "not_on_follow_up_list",
      "A household you picked is no longer on the follow-up list. Refresh the list and pick again.",
    );
  }

  await tx
    .insert(sessionHouseholds)
    .values(unique.map((householdId) => ({ sessionId, householdId })))
    .onConflictDoNothing();
  await tx
    .insert(sessionBlocks)
    .values(
      [...new Set(found.map((row) => row.blockId))].map((blockId) => ({ sessionId, blockId })),
    )
    .onConflictDoNothing();
}

export async function addSessionHouseholds(
  db: Database,
  sessionId: string,
  householdIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    assertPicksOpen(await lockSession(tx, sessionId));
    await pickHouseholds(tx, sessionId, householdIds);
  });
}

/* Which households a session picked, for a client to tell its list without reading it. */
export async function listPickedIds(db: Database, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ householdId: sessionHouseholds.householdId })
    .from(sessionHouseholds)
    .where(eq(sessionHouseholds.sessionId, sessionId))
    .orderBy(asc(sessionHouseholds.householdId));
  return rows.map((row) => row.householdId);
}

export type SessionHouseholdRow = {
  household: HouseholdRow;
  block: BlockRow;
  addedAt: Date;
  notes: FollowUpRow[];
  onList: boolean;
  visitedInSession: boolean;
};

/*
 * Every pick, on the list or not, by block then unit. A fixed number of
 * queries however many there are: the picks, their listed notes, which are
 * on the list now (by the list rule itself, never a copy of it), and which
 * were visited in this session (D-20-3).
 */
export async function listSessionHouseholds(
  db: Database,
  session: RevisitSession,
): Promise<SessionHouseholdRow[]> {
  const picked = db
    .select({ id: sessionHouseholds.householdId })
    .from(sessionHouseholds)
    .where(eq(sessionHouseholds.sessionId, session.id));

  const places = await db
    .select({ household: households, block: blocks, addedAt: sessionHouseholds.addedAt })
    .from(sessionHouseholds)
    .innerJoin(households, eq(households.id, sessionHouseholds.householdId))
    .innerJoin(blocks, eq(blocks.id, households.blockId))
    .where(eq(sessionHouseholds.sessionId, session.id))
    .orderBy(...byBlockThenUnit);

  /* Outstanding first, by due day with undated last, then the resolved. */
  const notes = await selectFollowUps(db)
    .where(
      and(inArray(followUps.householdId, picked), eq(followUps.status, "listed"), liveFollowUp),
    )
    .orderBy(
      sql`${followUps.doneAt} asc nulls first`,
      asc(followUps.dueDate),
      asc(followUps.createdAt),
    );

  const onList = await db
    .selectDistinct({ householdId: followUps.householdId })
    .from(followUps)
    .where(onRevisitList(db, session));

  const visited = await db
    .selectDistinct({ householdId: visits.householdId })
    .from(visits)
    .where(and(eq(visits.sessionId, session.id), inArray(visits.householdId, picked)));

  const onListIds = new Set(onList.map((row) => row.householdId));
  const visitedIds = new Set(visited.map((row) => row.householdId));

  return places.map(({ household, block, addedAt }) => ({
    household,
    block,
    addedAt,
    notes: notes.filter((note) => note.householdId === household.id),
    onList: onListIds.has(household.id),
    visitedInSession: visitedIds.has(household.id),
  }));
}

/*
 * Takes a household out of a session, and its block too once no other pick
 * is in it. Refused for the last household (a follow-up session always has
 * one), for one visited in this session (that visit is the session's work),
 * and where its block would leave while holding this session's visits, an
 * admin's off-list ones say: history is never orphaned by a UI action
 * (D-18-3).
 */
export async function removeSessionHousehold(
  db: Database,
  sessionId: string,
  householdId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    assertPicksOpen(await lockSession(tx, sessionId));

    const pick = await tx
      .select({ blockId: households.blockId })
      .from(sessionHouseholds)
      .innerJoin(households, eq(households.id, sessionHouseholds.householdId))
      .where(
        and(
          eq(sessionHouseholds.sessionId, sessionId),
          eq(sessionHouseholds.householdId, householdId),
        ),
      );
    const found = pick[0];
    if (!found) {
      throw new NotFoundError("That household is not in this session.");
    }

    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(sessionHouseholds)
      .where(eq(sessionHouseholds.sessionId, sessionId));
    if (firstOrThrow(counted, "the household count").total <= 1) {
      throw new ConflictError(
        "conflict",
        "A follow-up session needs at least one household, so the last one can't be removed.",
      );
    }

    const knocked = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.sessionId, sessionId), eq(visits.householdId, householdId)))
      .limit(1);
    if (knocked.length > 0) {
      throw new ConflictError(
        "conflict",
        "Someone has recorded a visit here in this session, so it stays in the session.",
      );
    }

    await tx
      .delete(sessionHouseholds)
      .where(
        and(
          eq(sessionHouseholds.sessionId, sessionId),
          eq(sessionHouseholds.householdId, householdId),
        ),
      );

    const neighbours = await tx
      .select({ householdId: sessionHouseholds.householdId })
      .from(sessionHouseholds)
      .innerJoin(households, eq(households.id, sessionHouseholds.householdId))
      .where(and(eq(sessionHouseholds.sessionId, sessionId), eq(households.blockId, found.blockId)))
      .limit(1);
    if (neighbours.length > 0) return;

    if (await blockHasSessionVisits(tx, sessionId, found.blockId)) {
      throw new ConflictError(
        "block_in_use",
        "Its block has visits recorded in this session, so this household stays in the session.",
      );
    }
    await tx
      .delete(sessionBlocks)
      .where(and(eq(sessionBlocks.sessionId, sessionId), eq(sessionBlocks.blockId, found.blockId)));
  });
}
