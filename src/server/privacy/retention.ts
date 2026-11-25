import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  erasureRequests,
  followUps,
  households,
  retentionRuns,
  signIns,
  users,
  visits,
} from "@/db/schema";
import type { Clock } from "@/lib/clock";
import { RETENTION_PERIODS } from "@/lib/privacy/policy";
import { EXPIRES_AFTER_SECONDS } from "@/server/auth/sign-ins";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import { eraseAccount, eraseHousehold } from "@/server/privacy/erasure";
import type { RetentionRunView } from "@/server/privacy/requests";

/*
 * The retention job (#279): erases what its period has outlived, whether or
 * not anyone asked. Time comes from the injected clock, never SQL now(), so a
 * test can stand either side of a boundary. Each household and account is its
 * own transaction: one failure costs one erasure, not the run.
 */

/* Per run, so one call stays short; `more` says the next run carries on. */
export const MAX_ERASURES_PER_RUN = 200;

/* A run that never finished (its host was cut off) stops holding the lease after this. */
const LEASE_MS = 60 * 60 * 1000;

const ONE_UNFINISHED = "retention_runs_one_unfinished_idx";

/* UTC calendar months, so a boundary never moves with the server's zone. */
function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

/*
 * Households that hold something and whose last activity - a visit stored, or
 * a note added, edited, listed, done, reopened or removed - is before the
 * cutoff. Amends do not count (D-279). Grouped subqueries left joined, not
 * correlated ones: Drizzle renders an interpolated column unqualified.
 */
async function dueHouseholds(db: Database, cutoff: Date): Promise<string[]> {
  const lastVisit = db
    .select({
      householdId: visits.householdId,
      at: sql`max(${visits.createdAt})`.mapWith(visits.createdAt).as("last_visit_at"),
    })
    .from(visits)
    .groupBy(visits.householdId)
    .as("last_visit");
  const lastNote = db
    .select({
      householdId: followUps.householdId,
      at: sql`max(greatest(${followUps.createdAt}, ${followUps.updatedAt}, ${followUps.listedAt}, ${followUps.doneAt}, ${followUps.deletedAt}))`
        .mapWith(followUps.createdAt)
        .as("last_note_at"),
    })
    .from(followUps)
    .groupBy(followUps.householdId)
    .as("last_note");

  /* A unit that holds nothing has nothing to erase, and is never erased again. */
  const holdsSomething = or(
    isNotNull(households.name),
    isNotNull(households.contact),
    isNotNull(households.religion),
    isNotNull(lastVisit.householdId),
    isNotNull(lastNote.householdId),
  );
  const lastActivity = sql<Date>`greatest(${lastVisit.at}, ${lastNote.at}, "households"."created_at")`;

  const due = await db
    .select({ id: households.id })
    .from(households)
    .leftJoin(lastVisit, eq(lastVisit.householdId, households.id))
    .leftJoin(lastNote, eq(lastNote.householdId, households.id))
    .where(and(holdsSomething, sql`${lastActivity} < ${cutoff.toISOString()}::timestamptz`))
    .orderBy(asc(lastActivity), asc(households.id))
    .limit(MAX_ERASURES_PER_RUN + 1);
  return due.map((row) => row.id);
}

/* Read under the household's lock, so a write that finished first is seen. */
async function activeSince(tx: Database, householdId: string, cutoff: Date): Promise<boolean> {
  const [visit, note] = await Promise.all([
    tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.householdId, householdId), gte(visits.createdAt, cutoff)))
      .limit(1),
    tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(
        and(
          eq(followUps.householdId, householdId),
          sql`greatest(${followUps.createdAt}, ${followUps.updatedAt}, ${followUps.listedAt}, ${followUps.doneAt}, ${followUps.deletedAt}) >= ${cutoff.toISOString()}::timestamptz`,
        ),
      )
      .limit(1),
  ]);
  return visit.length > 0 || note.length > 0;
}

async function holdsSomething(tx: Database, householdId: string): Promise<boolean> {
  const [household, visit, note] = await Promise.all([
    tx
      .select({ id: households.id })
      .from(households)
      .where(
        and(
          eq(households.id, householdId),
          or(
            isNotNull(households.name),
            isNotNull(households.contact),
            isNotNull(households.religion),
          ),
        ),
      )
      .limit(1),
    tx.select({ id: visits.id }).from(visits).where(eq(visits.householdId, householdId)).limit(1),
    tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(eq(followUps.householdId, householdId))
      .limit(1),
  ]);
  return household.length + visit.length + note.length > 0;
}

async function eraseDueHousehold(
  db: Database,
  id: string,
  cutoff: Date,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The household first, as eraseHousehold and every write to it do.
    await tx
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .for("update");
    // Activity that landed after the list was read saves it.
    if (await activeSince(tx, id, cutoff)) return false;
    // One an on-request erasure emptied meanwhile has nothing left to erase.
    if (!(await holdsSomething(tx, id))) return false;
    // Stamped at the cutoff, not the run: a record saved since then and synced late is new fieldwork.
    await eraseHousehold(tx, id, now, cutoff);
    /* The job erased it first, so any open request is carried out too, by nobody. */
    await tx
      .update(erasureRequests)
      .set({ erasedAt: now })
      .where(and(eq(erasureRequests.householdId, id), isNull(erasureRequests.erasedAt)));
    return true;
  });
}

async function dueAccounts(db: Database, cutoff: Date): Promise<string[]> {
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.erasedAt),
        or(
          // Left, and so deactivated: the 12 months run from then.
          and(eq(users.approval, "approved"), lt(users.deactivatedAt, cutoff)),
          // Turned down: nothing else changes a blocked account.
          and(eq(users.approval, "blocked"), lt(users.updatedAt, cutoff)),
          // Asked to join and never answered.
          and(eq(users.approval, "pending"), lt(users.createdAt, cutoff)),
        ),
      ),
    )
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(MAX_ERASURES_PER_RUN + 1);
  return due.map((row) => row.id);
}

/*
 * The lease: one unfinished row at a time, held by the unique index. A
 * session advisory lock would not hold through Neon's transaction-mode
 * pooler (D-250).
 */
async function takeLease(db: Database, now: Date): Promise<string> {
  await db
    .update(retentionRuns)
    .set({ finishedAt: now })
    .where(
      and(
        isNull(retentionRuns.finishedAt),
        lt(retentionRuns.startedAt, new Date(now.getTime() - LEASE_MS)),
      ),
    );
  try {
    const inserted = await db
      .insert(retentionRuns)
      .values({ startedAt: now })
      .returning({ id: retentionRuns.id });
    return firstOrThrow(inserted, "the run insert").id;
  } catch (error) {
    if (isConstraintViolation(error, ONE_UNFINISHED)) {
      throw new ConflictError("conflict", "A retention run is already under way.");
    }
    throw error;
  }
}

export async function runRetention(db: Database, clock: Clock): Promise<RetentionRunView> {
  const now = clock.now;
  const runId = await takeLease(db, now);
  const counts = { households: 0, accounts: 0, signIns: 0, more: false };

  try {
    const householdCutoff = monthsBefore(now, RETENTION_PERIODS.householdMonths);
    const dueIds = await dueHouseholds(db, householdCutoff);
    counts.more = dueIds.length > MAX_ERASURES_PER_RUN;
    for (const id of dueIds.slice(0, MAX_ERASURES_PER_RUN)) {
      if (await eraseDueHousehold(db, id, householdCutoff, now)) counts.households += 1;
    }

    const accountCutoff = monthsBefore(now, RETENTION_PERIODS.accountMonths);
    const accountIds = await dueAccounts(db, accountCutoff);
    counts.more ||= accountIds.length > MAX_ERASURES_PER_RUN;
    for (const id of accountIds.slice(0, MAX_ERASURES_PER_RUN)) {
      try {
        await db.transaction(async (tx) => {
          await eraseAccount(tx, id, null, now);
          /* As for a household: the job met any open request for it, by nobody. */
          await tx
            .update(erasureRequests)
            .set({ erasedAt: now })
            .where(and(eq(erasureRequests.userId, id), isNull(erasureRequests.erasedAt)));
        });
        counts.accounts += 1;
      } catch (error) {
        // An admin erased it between the list and its lock: nothing left to do.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }

    const deleted = await db
      .delete(signIns)
      .where(lt(signIns.lastUsedAt, new Date(now.getTime() - EXPIRES_AFTER_SECONDS * 1000)))
      .returning({ id: signIns.id });
    counts.signIns = deleted.length;
  } finally {
    await db
      .update(retentionRuns)
      .set({ finishedAt: now, ...counts })
      .where(eq(retentionRuns.id, runId));
  }
  return { ranAt: now, ...counts };
}
