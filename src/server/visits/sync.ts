import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel, Role, SessionKind, SessionStatus } from "@/db/schema";
import { blocks, households, outingSessions, sessionBlocks, visits } from "@/db/schema";
import type { Clock } from "@/lib/clock";
import { distinctUuidsInOrder, sameUuid } from "@/lib/uuid";
import { assertNotBeforeOuting, assertNotInFuture } from "@/server/visits/clock-rules";
import { firstOrThrow, getOrThrow, isConstraintViolation, presentOrThrow } from "@/server/db-utils";
import {
  offRevisitList,
  placeKey,
  unitsOffRevisitList,
  type RevisitSession,
} from "@/server/follow-ups/list-rule";
import {
  markDoneByVisit,
  markDoneByVisits,
  notesMarkedDoneByVisits,
} from "@/server/follow-ups/marked-by-visit";
import {
  autoJoin,
  canAmend,
  stampVisit,
  stampVisits,
  teamIdFor,
  VISIT_TEAM_FK,
} from "@/server/teams/access";
import { ApiError, ConflictError, InternalError, NotFoundError } from "@/server/http/errors";
import { requireText } from "@/server/http/text";
import { createThrottledLog, summarizeError } from "@/server/logging/error-log";
import type { HouseholdIdentity, VisitRow } from "@/server/visits/service";
import {
  assertRecordedAfterErasure,
  getVisits,
  upsertHousehold,
  upsertHouseholds,
} from "@/server/visits/service";

/*
 * Flushing the offline queue.
 *
 * Everything here is shaped by one fact: a flaky connection retries. The
 * client cannot know whether a request that timed out was applied, so it sends
 * again - and the second send must not create a second row. That is why the
 * visit id comes from the client and why every outcome is reported per item
 * rather than as one status for the batch.
 *
 * A batch costs a fixed number of round trips however long it is (#251): what
 * judging needs is read once, each item is judged in request order, new
 * records are written together, and the answers are read once.
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
  markedDone: string[];
  error: ApiError | null;
};

type ResolvedSession = RevisitSession & { startedAt: Date };

/* Whoever's queue is flushing; the cookie decides it, never the request. */
export type SyncCaller = { id: string; role: Role };

type WriteStatus = "applied" | "unchanged" | "stale";

/* What became of an item before its answer is read. */
type Result = { status: WriteStatus } | { failure: unknown };

type Write = {
  item: SyncItem;
  memberId: string;
  caller: SyncCaller;
  session: ResolvedSession;
  judgeList: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/* A request's id may be in either letter case; every id read back is lower (D-193). */
const keyOf = (id: string) => id.toLowerCase();

/*
 * The queue outlived the outing. An admin can reopen the session to let it
 * through, so this is a conflict the client can explain rather than a silent
 * discard of work already done at a door.
 */
const sessionEnded = () =>
  new ConflictError("session_not_active", "That session has ended. Ask an admin to reopen it.");

const notInSession = () => new ConflictError("conflict", "That block is not part of the session.");

type StoredVisit = {
  updatedAt: Date;
  memberId: string;
  teamId: string | null;
  sessionId: string;
  blockId: string;
  unitNumber: string;
};

type SessionRow = {
  id: string;
  kind: SessionKind;
  status: SessionStatus;
  startedAt: Date | null;
};

type BatchReads = {
  blocks: Set<string>;
  /* When each erased unit the batch names was erased, by placeKey. */
  erased: Map<string, Date>;
  stored: Map<string, StoredVisit>;
  sessions: SessionRow[];
};

/*
 * What judging needs, read once for the whole batch (D-251-2). Its ids are
 * distinct, so no item's write changes what another is judged on. Blocks
 * first, then the stored visits, whose sessions the last read takes along
 * with the ones named and the active one.
 */
async function readBatch(db: Database, items: readonly SyncItem[]): Promise<BatchReads> {
  const blockIds = distinctUuidsInOrder(items.map((item) => item.blockId));
  /*
   * Read with the blocks, not after them (D-279): one more statement per
   * batch whatever its size, and the check judgeItem makes needs nothing the
   * blocks say. A superset (every named block with every named unit) is read
   * and matched exactly in memory.
   */
  const [foundBlocks, erasedPlaces] = await Promise.all([
    db
      .select({ id: blocks.id })
      .from(blocks)
      .where(inArray(blocks.id, blockIds))
      .limit(blockIds.length),
    db
      .select({
        blockId: households.blockId,
        unitNumber: households.unitNumber,
        // Never null: only erased units are read, and the decoder keeps it a Date.
        erasedAt: sql`${households.erasedAt}`.mapWith(households.erasedAt).as("erased_at"),
      })
      .from(households)
      .where(
        and(
          isNotNull(households.erasedAt),
          inArray(households.blockId, blockIds),
          inArray(
            households.unitNumber,
            items.map((item) => item.unitNumber),
          ),
        ),
      ),
  ]);

  const stored = await db
    .select({
      id: visits.id,
      updatedAt: visits.updatedAt,
      memberId: visits.memberId,
      teamId: visits.teamId,
      sessionId: visits.sessionId,
      blockId: households.blockId,
      unitNumber: households.unitNumber,
    })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .where(
      inArray(
        visits.id,
        items.map((item) => item.id),
      ),
    );

  const sessionIds = distinctUuidsInOrder([
    ...items.flatMap((item) => (item.sessionId === undefined ? [] : [item.sessionId])),
    ...stored.map((visit) => visit.sessionId),
  ]);
  const sessions = await db
    .select({
      id: outingSessions.id,
      kind: outingSessions.kind,
      status: outingSessions.status,
      startedAt: outingSessions.startedAt,
    })
    .from(outingSessions)
    .where(or(inArray(outingSessions.id, sessionIds), eq(outingSessions.status, "active")));

  return {
    blocks: new Set(foundBlocks.map((block) => block.id)),
    erased: new Map(
      erasedPlaces.map((place) => [placeKey(place.blockId, place.unitNumber), place.erasedAt]),
    ),
    stored: new Map(stored.map((visit) => [visit.id, visit])),
    sessions,
  };
}

function resolveSession(reads: BatchReads, sessionId: string | undefined): ResolvedSession {
  const session =
    sessionId === undefined
      ? reads.sessions.find((row) => row.status === "active")
      : reads.sessions.find((row) => sameUuid(row.id, sessionId));
  if (!session) {
    throw sessionId === undefined
      ? new ConflictError("session_not_active", "No session is active.")
      : new NotFoundError("No such session.");
  }
  if (session.status !== "active") {
    throw sessionEnded();
  }
  return {
    id: session.id,
    kind: session.kind,
    startedAt: presentOrThrow(session.startedAt, "an active session start"),
  };
}

type Verdict =
  { kind: "answered"; status: "unchanged" | "stale" } | { kind: "amend" | "new"; write: Write };

/*
 * Every check that needs no lock, in the order they have always run: a refusal
 * throws. What is left is a replay to answer, or a record to write.
 */
async function judgeItem(
  db: Database,
  item: SyncItem,
  reads: BatchReads,
  caller: SyncCaller,
  clock: Clock,
): Promise<Verdict> {
  const memberId = caller.id;
  const incomingUpdatedAt = new Date(item.updatedAt);
  const incomingCreatedAt = new Date(item.clientCreatedAt);

  if (!reads.blocks.has(keyOf(item.blockId))) {
    throw new NotFoundError("No such block.");
  }

  const stored = reads.stored.get(keyOf(item.id));

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
      !sameUuid(item.blockId, stored.blockId) ||
      item.unitNumber !== stored.unitNumber ||
      (item.sessionId !== undefined && !sameUuid(item.sessionId, stored.sessionId))
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
      return { kind: "answered", status: "stale" };
    }
    if (incomingUpdatedAt.getTime() === stored.updatedAt.getTime()) {
      // A replay of something already stored: the normal retry outcome.
      return { kind: "answered", status: "unchanged" };
    }
  }

  /*
   * A record with no stored visit is a new knock, or an amend of a visit an
   * erasure deleted: either way it must not bring back what was erased. Before
   * the clock bounds, so a restamp after a skew refusal cannot slip past it.
   */
  assertRecordedAfterErasure(
    { erasedAt: reads.erased.get(placeKey(item.blockId, item.unitNumber)) ?? null },
    incomingCreatedAt,
  );

  /*
   * After the replay short-circuit, so a stored record is never re-judged (a
   * lowered tolerance must not turn a retry into a rejection), yet before any
   * write.
   */
  assertNotInFuture(incomingUpdatedAt, clock);
  assertNotInFuture(incomingCreatedAt, clock);

  // A stored visit keeps its own outing even when the item names none.
  const session = resolveSession(reads, stored?.sessionId ?? item.sessionId);

  /*
   * After the session check, so an ended session still reports itself first.
   * Active sessions always have a start time: activation sets it.
   */
  assertNotBeforeOuting(incomingUpdatedAt, session.startedAt, clock);
  assertNotBeforeOuting(incomingCreatedAt, session.startedAt, clock);

  const write: Write = {
    item,
    memberId,
    caller,
    session,
    /*
     * The caller's role decides the list (refuseUnderLock), though canAmend
     * above still asks the member question.
     */
    judgeList: !stored,
    createdAt: incomingCreatedAt,
    updatedAt: incomingUpdatedAt,
  };
  return { kind: stored ? "amend" : "new", write };
}

type Judged = { key: string; verdict: Verdict };

type RunEntry = { key: string; write: Write };

type Step =
  | { kind: "run"; session: ResolvedSession; entries: RunEntry[] }
  | { kind: "amend"; key: string; write: Write };

/*
 * The writes, in request order. Consecutive new records in one session are
 * one run, written together; an amend is written alone, in its place. An
 * item with nothing to write breaks no run (D-251-3, D-251-5).
 */
export function splitWrites(judged: readonly Judged[]): Step[] {
  const steps: Step[] = [];
  let run: Extract<Step, { kind: "run" }> | undefined;
  for (const { key, verdict } of judged) {
    if (verdict.kind === "answered") continue;
    const { write } = verdict;
    if (verdict.kind === "amend") {
      steps.push({ kind: "amend", key, write });
      run = undefined;
    } else if (run?.session.id === write.session.id) {
      run.entries.push({ key, write });
    } else {
      run = { kind: "run", session: write.session, entries: [{ key, write }] };
      steps.push(run);
    }
  }
  return steps;
}

async function settle(work: () => Promise<WriteStatus>): Promise<Result> {
  try {
    return { status: await work() };
  } catch (failure) {
    return { failure };
  }
}

async function persistOne(db: Database, write: Write): Promise<WriteStatus> {
  try {
    return await persist(db, write);
  } catch (error) {
    if (!isConstraintViolation(error, VISIT_TEAM_FK)) throw error;
    /*
     * The team this record was about to be stamped with was disbanded between
     * reading it and inserting. A second attempt re-reads the author's team,
     * which is now none or another one, instead of holding a good record.
     */
    return persist(db, write);
  }
}

/*
 * The first thing a write does: lock its session's row (FOR KEY SHARE), as
 * changing a follow-up session's households does (FOR UPDATE), then judge
 * where each record may land, before any is written: the refusals, by
 * record. So a record and a household change always wait for each other in
 * one order, and whichever goes second sees what the other committed: a
 * remove sees this visit, or this sees the remove.
 */
async function refuseUnderLock(
  tx: Database,
  session: ResolvedSession,
  writes: readonly Write[],
  caller: SyncCaller,
): Promise<Map<Write, ApiError>> {
  const locked = await tx
    .select({ status: outingSessions.status })
    .from(outingSessions)
    .where(eq(outingSessions.id, session.id))
    .for("key share");
  if (firstOrThrow(locked, "the session lock").status !== "active") {
    return new Map(writes.map((write) => [write, sessionEnded()]));
  }

  const attached = await tx
    .select({ blockId: sessionBlocks.blockId })
    .from(sessionBlocks)
    .where(
      and(
        eq(sessionBlocks.sessionId, session.id),
        inArray(
          sessionBlocks.blockId,
          distinctUuidsInOrder(writes.map((write) => write.item.blockId)),
        ),
      ),
    );
  const attachedIds = new Set(attached.map((row) => row.blockId));
  const refused = new Map<Write, ApiError>();
  for (const write of writes) {
    if (!attachedIds.has(keyOf(write.item.blockId))) refused.set(write, notInSession());
  }

  /*
   * Only a new record is judged against the follow-up list: an amend
   * corrects a visit already stored, wherever it was allowed at the time.
   */
  const listed = writes.filter((write) => write.judgeList && !refused.has(write));
  const off = await unitsOffRevisitList(
    tx,
    caller,
    session,
    listed.map((write) => write.item),
  );
  for (const write of listed) {
    if (off.has(write.item)) refused.set(write, offRevisitList());
  }
  return refused;
}

/*
 * persist's insert for a run of new records, a statement each for the
 * households, the team, the visits, the stamp, the join and the marking,
 * however many records there are. Locks are taken as one record takes them:
 * the session (already held), households in one order, visits, then notes.
 */
async function insertRun(
  tx: Database,
  session: ResolvedSession,
  writes: readonly Write[],
  caller: SyncCaller,
): Promise<void> {
  const placed = await upsertHouseholds(
    tx,
    writes.map((write) => write.item),
  );
  const teamId = await teamIdFor(tx, caller.id, session.id);

  const placedWrites = writes.map(({ item, createdAt, updatedAt }, order) => {
    const household = getOrThrow(
      placed,
      placeKey(item.blockId, item.unitNumber),
      "the record's household",
    );
    /* An erasure landed since the batch read: the run rolls back and each record is judged alone. */
    assertRecordedAfterErasure(household, createdAt);
    return { household, item, createdAt, updatedAt, order };
  });
  const rows = placedWrites.map(({ household, item, createdAt, updatedAt, order }) => ({
    id: item.id,
    householdId: household.id,
    sessionId: session.id,
    memberId: caller.id,
    teamId,
    interestLevel: item.interestLevel,
    description: item.description ?? "",
    clientCreatedAt: createdAt,
    updatedAt,
    /*
     * now() is the transaction's start, the same for every row; a
     * microsecond apart keeps them in request order wherever visits are
     * ordered by when they were stored (D-251-7).
     */
    createdAt: sql`now() + ${order}::integer * interval '1 microsecond'`,
  }));

  const inserted = await tx
    .insert(visits)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: visits.id });
  if (inserted.length < rows.length) {
    // Stored by another request since the batch read: persistRun sends the run again one by one.
    throw new Error("A record of the run was stored meanwhile.");
  }

  await stampVisits(
    tx,
    rows.map((row) => row.id),
    teamId,
    caller.id,
  );
  await autoJoin(tx, session.id, caller.id);
  await markDoneByVisits(
    tx,
    session,
    rows.map((row) => ({ householdId: row.householdId, visitId: row.id })),
    caller.id,
  );
}

/*
 * Writes a run of new records in one transaction (D-251-3). If it fails for
 * any reason - one of its records stored meanwhile, a team disbanded, a
 * deadlock - it rolls back and each record goes again through persist, on
 * its own, which settles each as recording it alone always has (D-251-4).
 * A race is not an error, so the run's failure is not logged (D-251-11).
 */
async function persistRun(
  db: Database,
  session: ResolvedSession,
  entries: readonly RunEntry[],
  caller: SyncCaller,
): Promise<[string, Result][]> {
  let refused: Map<Write, ApiError>;
  try {
    refused = await db.transaction(async (tx) => {
      const writes = entries.map((entry) => entry.write);
      const refusals = await refuseUnderLock(tx, session, writes, caller);
      const landing = writes.filter((write) => !refusals.has(write));
      if (landing.length > 0) await insertRun(tx, session, landing, caller);
      return refusals;
    });
  } catch {
    const results: [string, Result][] = [];
    for (const { key, write } of entries) {
      results.push([key, await settle(() => persistOne(db, write))]);
    }
    return results;
  }
  return entries.map(({ key, write }) => {
    const refusal = refused.get(write);
    return [key, refusal === undefined ? { status: "applied" } : { failure: refusal }];
  });
}

/* Thrown inside the transaction to roll its writes back without failing the item. */
class NotApplied extends Error {
  constructor(readonly status: "unchanged" | "stale") {
    super(status);
  }
}

/*
 * Writes one item atomically. The checks in judgeItem ran on a read that other
 * requests may have outdated, so the decisive ones are made or repeated here:
 *
 * - Where it may land (refuseUnderLock) is judged first, under the session lock.
 * - INSERT ... ON CONFLICT DO NOTHING says whether this call created the row,
 *   which is what decides who writes the teammate snapshot when two flushes
 *   race. Only one inserts.
 * - Otherwise the row is locked (SELECT ... FOR NO KEY UPDATE, as PATCH
 *   takes it; see lockForAmend) and re-judged: the amend applies only if the
 *   stored row is still older and the caller is still its author or a
 *   current teammate. A concurrent writer finishes first, and this sees what
 *   it committed.
 *
 * Author, session, team, household and clientCreatedAt are set at insert and
 * never in the UPDATE (D-29-2, D-74-16).
 */
async function persist(db: Database, write: Write): Promise<WriteStatus> {
  const { item, memberId, session, createdAt, updatedAt } = write;
  const sessionId = session.id;
  try {
    await db.transaction(async (tx) => {
      const refusal = (await refuseUnderLock(tx, session, [write], write.caller)).get(write);
      if (refusal !== undefined) throw refusal;
      const household = await upsertHousehold(tx, {
        blockId: item.blockId,
        unitNumber: item.unitNumber,
        name: item.name,
        contact: item.contact,
        religion: item.religion,
      });
      assertRecordedAfterErasure(household, createdAt);
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
        await markDoneByVisit(tx, session, household.id, item.id, memberId);
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
          .for("no key update")
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

function rejected(item: SyncItem, failure: unknown): SyncOutcome {
  // The client gets only the generic message; the cause stays in the logs.
  if (!(failure instanceof ApiError)) {
    logSyncFailure("sync", `sync: could not save visit ${item.id}: ${summarizeError(failure)}`);
  }
  return {
    id: item.id,
    status: "rejected",
    visit: null,
    markedDone: [],
    /*
     * Anything that is not a deliberate refusal - a dropped connection, a
     * deadlock - is the server's failure, not the record's. It is reported
     * as internal_error so the queue retries it, where `conflict` would
     * hold a good record for review forever (D-74-23).
     */
    error:
      failure instanceof ApiError
        ? failure
        : new InternalError("Could not save this record right now. Try again."),
  };
}

type Answers = { visits: Map<string, VisitRow>; marked: Map<string, string[]> };

/*
 * The stored rows every answer reports, read once after every write
 * (D-251-9). Should the read fail, what was written stays written, and a
 * resend answers it unchanged.
 */
async function readAnswers(
  db: Database,
  keys: readonly string[],
): Promise<Answers | { failure: unknown }> {
  if (keys.length === 0) {
    return { visits: new Map(), marked: new Map() };
  }
  try {
    return { visits: await getVisits(db, keys), marked: await notesMarkedDoneByVisits(db, keys) };
  } catch (failure) {
    return { failure };
  }
}

function outcome(
  item: SyncItem,
  result: Result,
  answers: Answers | { failure: unknown },
): SyncOutcome {
  if ("failure" in result) return rejected(item, result.failure);
  if ("failure" in answers) return rejected(item, answers.failure);
  const key = keyOf(item.id);
  try {
    return {
      id: item.id,
      status: result.status,
      visit: getOrThrow(answers.visits, key, "the visit just written"),
      markedDone: answers.marked.get(key) ?? [],
      error: null,
    };
  } catch (failure) {
    return rejected(item, failure);
  }
}

async function judgeAndWrite(
  db: Database,
  items: readonly SyncItem[],
  caller: SyncCaller,
  clock: Clock,
  results: Map<string, Result>,
): Promise<void> {
  let reads: BatchReads;
  try {
    reads = await readBatch(db, items);
  } catch (failure) {
    for (const item of items) results.set(keyOf(item.id), { failure });
    return;
  }

  const judged: Judged[] = [];
  for (const item of items) {
    const key = keyOf(item.id);
    try {
      const verdict = await judgeItem(db, item, reads, caller, clock);
      if (verdict.kind === "answered") results.set(key, { status: verdict.status });
      judged.push({ key, verdict });
    } catch (failure) {
      results.set(key, { failure });
    }
  }

  for (const step of splitWrites(judged)) {
    if (step.kind === "amend") {
      results.set(step.key, await settle(() => persistOne(db, step.write)));
    } else {
      for (const [key, result] of await persistRun(db, step.session, step.entries, caller)) {
        results.set(key, result);
      }
    }
  }
}

/* Ids are distinct in the batch: a repeat goes to syncOneByOne. */
async function syncBatch(
  db: Database,
  sent: readonly SyncItem[],
  caller: SyncCaller,
  clock: Clock,
): Promise<SyncOutcome[]> {
  const results = new Map<string, Result>();
  const items: SyncItem[] = [];
  for (const item of sent) {
    /*
     * First, so a blank unit is this item's refusal alone and nothing is read
     * for it. The contract refuses the whole batch before this; the guard is
     * for a caller that skips the contract. From here on the unit is as stored.
     */
    try {
      items.push({ ...item, unitNumber: requireText(item.unitNumber, "/unitNumber") });
    } catch (failure) {
      results.set(keyOf(item.id), { failure });
    }
  }
  if (items.length > 0) {
    await judgeAndWrite(db, items, caller, clock, results);
  }

  const answers = await readAnswers(
    db,
    [...results].flatMap(([key, result]) => ("status" in result ? [key] : [])),
  );
  return sent.map((item) =>
    outcome(item, getOrThrow(results, keyOf(item.id), "the item's result"), answers),
  );
}

/*
 * A batch naming one visit twice, in any letter case, goes one item at a
 * time, so the second copy is judged on what the first stored (D-251-10).
 * The queue is keyed by id, so this is rare.
 */
async function syncOneByOne(
  db: Database,
  items: readonly SyncItem[],
  caller: SyncCaller,
  clock: Clock,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of items) {
    outcomes.push(...(await syncBatch(db, [item], caller, clock)));
  }
  return outcomes;
}

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
  const ids = new Set(items.map((item) => keyOf(item.id)));
  return ids.size < items.length
    ? syncOneByOne(db, items, caller, clock)
    : syncBatch(db, items, caller, clock);
}
