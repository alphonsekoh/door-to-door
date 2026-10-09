import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel } from "@/db/schema";
import { blocks, households, outingSessions, sessionBlocks, visits } from "@/db/schema";
import { and } from "drizzle-orm";
import type { Clock } from "@/lib/clock";
import { assertNotBeforeOuting, assertNotInFuture } from "@/server/visits/clock-rules";
import { firstOrThrow, presentOrThrow } from "@/server/db-utils";
import { autoJoin, canAmend, stampVisit, teamIdFor } from "@/server/teams/access";
import { ApiError, ConflictError, NotFoundError } from "@/server/http/errors";
import type { HouseholdIdentity, VisitRow } from "@/server/visits/service";
import { getVisit, upsertHousehold } from "@/server/visits/service";

/*
 * Flushing the offline queue.
 *
 * Everything here is shaped by one fact: a flaky connection retries. The
 * client cannot know whether a request that timed out was applied, so it sends
 * again - and the second send must not create a second row. That is why the
 * visit id comes from the client and why every outcome is reported per item
 * rather than as one status for the batch.
 */

export type SyncItem = {
  id: string;
  blockId: string;
  unitNumber: string;
  sessionId?: string | undefined;
  interestLevel: InterestLevel;
  description?: string | undefined;
  clientCreatedAt: string;
  updatedAt: string;
} & HouseholdIdentity;

export type SyncStatus = "applied" | "unchanged" | "stale" | "rejected";

export type SyncOutcome = {
  id: string;
  status: SyncStatus;
  visit: VisitRow | null;
  error: ApiError | null;
};

type ResolvedSession = { id: string; startedAt: Date };

async function resolveSession(
  db: Database,
  sessionId: string | undefined,
): Promise<ResolvedSession> {
  if (sessionId !== undefined) {
    const found = await db
      .select({
        id: outingSessions.id,
        status: outingSessions.status,
        startedAt: outingSessions.startedAt,
      })
      .from(outingSessions)
      .where(eq(outingSessions.id, sessionId))
      .limit(1);

    const session = found[0];
    if (!session) {
      throw new NotFoundError("No such session.");
    }
    if (session.status !== "active") {
      /*
       * The queue outlived the outing. An admin can reopen the session to let
       * it through, so this is a conflict the client can explain rather than a
       * silent discard of work already done at a door.
       */
      throw new ConflictError(
        "session_not_active",
        "That session has ended. Ask an admin to reopen it.",
      );
    }
    return {
      id: session.id,
      startedAt: presentOrThrow(session.startedAt, "an active session start"),
    };
  }

  const active = await db
    .select({ id: outingSessions.id, startedAt: outingSessions.startedAt })
    .from(outingSessions)
    .where(eq(outingSessions.status, "active"))
    .limit(1);

  const session = active[0];
  if (!session) {
    throw new ConflictError("session_not_active", "No session is active.");
  }
  return {
    id: session.id,
    startedAt: presentOrThrow(session.startedAt, "an active session start"),
  };
}

async function applyItem(
  db: Database,
  item: SyncItem,
  memberId: string,
  clock: Clock,
): Promise<SyncOutcome> {
  const incomingUpdatedAt = new Date(item.updatedAt);
  const incomingCreatedAt = new Date(item.clientCreatedAt);
  const blockExists = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(eq(blocks.id, item.blockId))
    .limit(1);

  if (blockExists.length === 0) {
    throw new NotFoundError("No such block.");
  }

  const existing = await db
    .select({
      updatedAt: visits.updatedAt,
      memberId: visits.memberId,
      teamId: visits.teamId,
      sessionId: visits.sessionId,
      blockId: households.blockId,
      unitNumber: households.unitNumber,
    })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(eq(visits.id, item.id))
    .limit(1);

  const stored = existing[0];

  if (stored) {
    /*
     * Sync never judges an admin: they amend through PATCH /visits/{id}. So
     * this asks the member question - the author, or a CURRENT teammate.
     */
    if (!(await canAmend(db, { id: memberId, role: "member" }, stored))) {
      throw new ConflictError("conflict", "That visit belongs to another member.");
    }
    /*
     * An item amends a stored visit in place; it never relocates it. Applies
     * to the author too: moving a record to another unit is a new record.
     */
    if (
      item.blockId !== stored.blockId ||
      item.unitNumber.trim() !== stored.unitNumber ||
      (item.sessionId !== undefined && item.sessionId !== stored.sessionId)
    ) {
      throw new ConflictError(
        "conflict",
        "A saved visit cannot be moved to another unit or outing.",
      );
    }
    if (incomingUpdatedAt < stored.updatedAt) {
      /*
       * An older edit arriving after a newer one. Acknowledged so the client
       * clears it from the queue, but not applied - last write wins.
       */
      return { id: item.id, status: "stale", visit: await getVisit(db, item.id), error: null };
    }
    if (incomingUpdatedAt.getTime() === stored.updatedAt.getTime()) {
      // A replay of something already stored: the normal retry outcome.
      return { id: item.id, status: "unchanged", visit: await getVisit(db, item.id), error: null };
    }
  }

  /*
   * After the replay short-circuit, so a stored record is never re-judged (a
   * lowered tolerance must not turn a retry into a rejection), yet before any
   * write.
   */
  assertNotInFuture(incomingUpdatedAt, clock);
  assertNotInFuture(incomingCreatedAt, clock);

  // A stored visit keeps its own outing even when the item names none.
  const session = await resolveSession(db, stored?.sessionId ?? item.sessionId);
  const sessionId = session.id;

  /*
   * After the session check, so an ended session still reports itself first.
   * Active sessions always have a start time: activation sets it.
   */
  assertNotBeforeOuting(incomingUpdatedAt, session.startedAt, clock);
  assertNotBeforeOuting(incomingCreatedAt, session.startedAt, clock);

  const attached = await db
    .select({ blockId: sessionBlocks.blockId })
    .from(sessionBlocks)
    .where(and(eq(sessionBlocks.sessionId, sessionId), eq(sessionBlocks.blockId, item.blockId)))
    .limit(1);

  if (attached.length === 0) {
    throw new ConflictError("conflict", "That block is not part of the session.");
  }

  await db.transaction(async (tx) => {
    const household = await upsertHousehold(tx, {
      blockId: item.blockId,
      unitNumber: item.unitNumber,
      name: item.name,
      contact: item.contact,
      religion: item.religion,
    });
    const teamId = await teamIdFor(tx, memberId, sessionId);

    /*
     * Upsert on the client-generated id. Two devices flushing the same queued
     * record concurrently both land here, and the row is written once.
     *
     * The conflict branch rewrites only what an amend may change. Author,
     * session, team, household and clientCreatedAt are set once at insert
     * (D-29-2, D-74-16): a teammate's flush must not take the record over.
     */
    const written = await tx
      .insert(visits)
      .values({
        id: item.id,
        householdId: household.id,
        sessionId,
        memberId,
        teamId,
        interestLevel: item.interestLevel,
        description: item.description ?? "",
        clientCreatedAt: incomingCreatedAt,
        updatedAt: incomingUpdatedAt,
      })
      .onConflictDoUpdate({
        target: visits.id,
        set: {
          interestLevel: item.interestLevel,
          description: item.description ?? "",
          updatedAt: incomingUpdatedAt,
        },
      })
      // xmax is zero only on a row this statement inserted, which is what
      // decides who writes the teammate snapshot when two flushes race.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    if (firstOrThrow(written, "the visit upsert").inserted) {
      await stampVisit(tx, item.id, teamId, memberId);
      await autoJoin(tx, sessionId, memberId);
    }
  });

  return { id: item.id, status: "applied", visit: await getVisit(db, item.id), error: null };
}

/*
 * One bad item must not reject its valid siblings: a member whose queue holds
 * one malformed record should still get the rest of their afternoon saved.
 */
export async function syncVisits(
  db: Database,
  items: SyncItem[],
  memberId: string,
  clock: Clock,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of items) {
    try {
      outcomes.push(await applyItem(db, item, memberId, clock));
    } catch (error) {
      outcomes.push({
        id: item.id,
        status: "rejected",
        visit: null,
        error: error instanceof ApiError ? error : new ConflictError("conflict", "Could not save."),
      });
    }
  }
  return outcomes;
}
