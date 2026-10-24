import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel, Role } from "@/db/schema";
import { blocks, households, outingSessions, sessionBlocks, visits } from "@/db/schema";
import type { Clock } from "@/lib/clock";
import { assertNotBeforeOuting, assertNotInFuture } from "@/server/visits/clock-rules";
import { firstOrThrow, isConstraintViolation, presentOrThrow } from "@/server/db-utils";
import { assertMayRecordHere, type RevisitSession } from "@/server/follow-ups/list-rule";
import { autoJoin, canAmend, stampVisit, teamIdFor, VISIT_TEAM_FK } from "@/server/teams/access";
import { ApiError, ConflictError, InternalError, NotFoundError } from "@/server/http/errors";
import { createThrottledLog, summarizeError } from "@/server/logging/error-log";
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

type ResolvedSession = RevisitSession & { startedAt: Date };

/* Whoever's queue is flushing; the cookie decides it, never the request. */
export type SyncCaller = { id: string; role: Role };

async function resolveSession(
  db: Database,
  sessionId: string | undefined,
): Promise<ResolvedSession> {
  if (sessionId !== undefined) {
    const found = await db
      .select({
        id: outingSessions.id,
        kind: outingSessions.kind,
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
      kind: session.kind,
      startedAt: presentOrThrow(session.startedAt, "an active session start"),
    };
  }

  const active = await db
    .select({
      id: outingSessions.id,
      kind: outingSessions.kind,
      startedAt: outingSessions.startedAt,
    })
    .from(outingSessions)
    .where(eq(outingSessions.status, "active"))
    .limit(1);

  const session = active[0];
  if (!session) {
    throw new ConflictError("session_not_active", "No session is active.");
  }
  return {
    id: session.id,
    kind: session.kind,
    startedAt: presentOrThrow(session.startedAt, "an active session start"),
  };
}

async function applyItem(
  db: Database,
  item: SyncItem,
  caller: SyncCaller,
  clock: Clock,
): Promise<SyncOutcome> {
  const memberId = caller.id;
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
        "A saved visit cannot be moved to another unit or session.",
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

  /*
   * After the session check, so an ended session still reports itself first.
   * Active sessions always have a start time: activation sets it.
   */
  assertNotBeforeOuting(incomingUpdatedAt, session.startedAt, clock);
  assertNotBeforeOuting(incomingCreatedAt, session.startedAt, clock);

  const write = {
    item,
    memberId,
    caller,
    session,
    /*
     * Only a new record is judged against the follow-up list: an amend
     * corrects a visit already stored, wherever it was allowed at the time.
     * The caller's role decides there, though canAmend above still asks the
     * member question.
     */
    judgeList: !stored,
    createdAt: incomingCreatedAt,
    updatedAt: incomingUpdatedAt,
  };
  let status: "applied" | "unchanged" | "stale";
  try {
    status = await persist(db, write);
  } catch (error) {
    if (!isConstraintViolation(error, VISIT_TEAM_FK)) throw error;
    /*
     * The team this record was about to be stamped with was disbanded between
     * reading it and inserting. A second attempt re-reads the author's team,
     * which is now none or another one, instead of holding a good record.
     */
    status = await persist(db, write);
  }

  return { id: item.id, status, visit: await getVisit(db, item.id), error: null };
}

type Write = {
  item: SyncItem;
  memberId: string;
  caller: SyncCaller;
  session: ResolvedSession;
  judgeList: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/*
 * The first thing a write does: lock its session's row (FOR KEY SHARE), as
 * changing a follow-up session's households does (FOR UPDATE), then judge
 * where the item may land. So a record and a household change always wait
 * for each other in one order, and whichever goes second sees what the
 * other committed: a remove sees this visit, or this sees the remove.
 */
async function assertMayLand(
  tx: Database,
  { item, caller, session, judgeList }: Write,
): Promise<void> {
  const locked = await tx
    .select({ status: outingSessions.status })
    .from(outingSessions)
    .where(eq(outingSessions.id, session.id))
    .for("key share");
  if (firstOrThrow(locked, "the session lock").status !== "active") {
    throw new ConflictError(
      "session_not_active",
      "That session has ended. Ask an admin to reopen it.",
    );
  }

  const attached = await tx
    .select({ blockId: sessionBlocks.blockId })
    .from(sessionBlocks)
    .where(and(eq(sessionBlocks.sessionId, session.id), eq(sessionBlocks.blockId, item.blockId)))
    .limit(1);
  if (attached.length === 0) {
    throw new ConflictError("conflict", "That block is not part of the session.");
  }

  if (judgeList) {
    await assertMayRecordHere(tx, caller, session, item.blockId, item.unitNumber);
  }
}

/* Thrown inside the transaction to roll its writes back without failing the item. */
class NotApplied extends Error {
  constructor(readonly status: "unchanged" | "stale") {
    super(status);
  }
}

/*
 * Writes one item atomically. The checks in applyItem ran on a read that other
 * requests may have outdated, so the decisive ones are made or repeated here:
 *
 * - Where it may land (assertMayLand) is judged first, under the session lock.
 * - INSERT ... ON CONFLICT DO NOTHING says whether this call created the row,
 *   which is what decides who writes the teammate snapshot when two flushes
 *   race. Only one inserts.
 * - Otherwise the row is locked (SELECT ... FOR UPDATE) and re-judged: the
 *   amend applies only if the stored row is still older and the caller is
 *   still its author or a current teammate. A concurrent writer finishes
 *   first, and this sees what it committed.
 *
 * Author, session, team, household and clientCreatedAt are set at insert and
 * never in the UPDATE (D-29-2, D-74-16).
 */
async function persist(db: Database, write: Write): Promise<"applied" | "unchanged" | "stale"> {
  const { item, memberId, session, createdAt, updatedAt } = write;
  const sessionId = session.id;
  try {
    await db.transaction(async (tx) => {
      await assertMayLand(tx, write);
      const household = await upsertHousehold(tx, {
        blockId: item.blockId,
        unitNumber: item.unitNumber,
        name: item.name,
        contact: item.contact,
        religion: item.religion,
      });
      const teamId = await teamIdFor(tx, memberId, sessionId);
      const description = item.description ?? "";

      const inserted = await tx
        .insert(visits)
        .values({
          id: item.id,
          householdId: household.id,
          sessionId,
          memberId,
          teamId,
          interestLevel: item.interestLevel,
          description,
          clientCreatedAt: createdAt,
          updatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: visits.id });

      if (inserted.length > 0) {
        await stampVisit(tx, item.id, teamId, memberId);
        await autoJoin(tx, sessionId, memberId);
        return;
      }

      /*
       * Lock the row, then judge it. Each statement gets a fresh snapshot, so
       * after waiting for a concurrent writer this sees what it committed -
       * a newer updatedAt, or a teammate removed - rather than what the
       * caller read earlier.
       */
      const locked = firstOrThrow(
        await tx
          .select({
            updatedAt: visits.updatedAt,
            memberId: visits.memberId,
            teamId: visits.teamId,
            householdId: visits.householdId,
            sessionId: visits.sessionId,
          })
          .from(visits)
          .where(eq(visits.id, item.id))
          .for("update")
          .limit(1),
        "the stored visit",
      );
      /*
       * The pre-read missed a row created since, so location is judged again.
       * Throwing rolls back the identity upsert above, which already wrote to
       * whichever household this item named.
       */
      if (locked.householdId !== household.id || locked.sessionId !== sessionId) {
        throw new ConflictError(
          "conflict",
          "A saved visit cannot be moved to another unit or session.",
        );
      }
      if (!(await canAmend(tx, { id: memberId, role: "member" }, locked))) {
        throw new ConflictError("conflict", "That visit belongs to another member.");
      }
      if (updatedAt <= locked.updatedAt) {
        throw new NotApplied(updatedAt < locked.updatedAt ? "stale" : "unchanged");
      }

      await tx
        .update(visits)
        .set({ interestLevel: item.interestLevel, description, updatedAt })
        .where(eq(visits.id, item.id));
    });
  } catch (error) {
    if (error instanceof NotApplied) return error.status;
    throw error;
  }
  return "applied";
}

const logSyncFailure = createThrottledLog();

/*
 * One bad item must not reject its valid siblings: a member whose queue holds
 * one malformed record should still get the rest of their afternoon saved.
 */
export async function syncVisits(
  db: Database,
  items: SyncItem[],
  caller: SyncCaller,
  clock: Clock,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of items) {
    try {
      outcomes.push(await applyItem(db, item, caller, clock));
    } catch (error) {
      // The client gets only the generic message; the cause stays in the logs.
      if (!(error instanceof ApiError)) {
        logSyncFailure("sync", `sync: could not save visit ${item.id}: ${summarizeError(error)}`);
      }
      outcomes.push({
        id: item.id,
        status: "rejected",
        visit: null,
        /*
         * Anything that is not a deliberate refusal - a dropped connection, a
         * deadlock - is the server's failure, not the record's. It is reported
         * as internal_error so the queue retries it, where `conflict` would
         * hold a good record for review forever (D-74-23).
         */
        error:
          error instanceof ApiError
            ? error
            : new InternalError("Could not save this record right now. Try again."),
      });
    }
  }
  return outcomes;
}
