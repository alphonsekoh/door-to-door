import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { FollowUpStatus, Role } from "@/db/schema";
import { followUps, households, visits } from "@/db/schema";
import { waitingSentence } from "@/lib/follow-ups/waiting";
import { firstName } from "@/lib/session/own-name";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { isNoteOnActiveRevisitList, liveFollowUp } from "@/server/follow-ups/list-rule";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/http/errors";
import { requireText } from "@/server/http/text";
import { type FollowUpRow, selectFollowUps } from "@/server/visits/queries";

/*
 * Follow-up notes.
 *
 * They attach to the household, not the session, so a promise made in January
 * is still there when someone knocks on that door in August. That is the whole
 * reason the feature exists, and it is why nothing here is scoped to a session.
 *
 * Only an admin decides what is owed: an admin's note goes on the follow-up
 * list (`listed`), while a member's is a suggestion for an admin to review.
 * Removal is soft everywhere, so a declined suggestion can be explained.
 */

export type Actor = { id: string; role: Role };

/* The database's one-pending-suggestion rule, which decides a race. */
export const ONE_OPEN_SUGGESTION = "follow_ups_one_open_suggestion_idx";

const EXISTS_MESSAGE =
  "This household is already on the follow-up list or has a suggestion waiting.";
const PENDING_MESSAGE =
  "A member has suggested this household and it is waiting for review. Add that suggestion to the list instead.";

export type ListFollowUpOptions = {
  householdId?: string | undefined;
  authorId?: string | undefined;
  status?: FollowUpStatus | undefined;
  outstanding?: boolean | undefined;
  dueBefore?: string | undefined;
  deleted?: boolean | undefined;
  /* With `deleted` only: removed by someone else (true) or by the author (false). */
  removedByOthers?: boolean | undefined;
  deletedSince?: string | undefined;
  limit: number;
  offset: number;
};

export async function listFollowUps(
  db: Database,
  options: ListFollowUpOptions,
): Promise<{ rows: FollowUpRow[]; total: number }> {
  const conditions = [
    options.deleted === true ? isNotNull(followUps.deletedAt) : liveFollowUp,
    ...(options.householdId === undefined ? [] : [eq(followUps.householdId, options.householdId)]),
    ...(options.authorId === undefined ? [] : [eq(followUps.authorId, options.authorId)]),
    ...(options.status === undefined ? [] : [eq(followUps.status, options.status)]),
    ...(options.outstanding === true ? [isNull(followUps.doneAt)] : []),
    ...(options.outstanding === false ? [isNotNull(followUps.doneAt)] : []),
    ...(options.dueBefore === undefined
      ? []
      : [lt(followUps.dueDate, new Date(options.dueBefore))]),
    ...(options.removedByOthers === true
      ? [isNotNull(followUps.deletedBy), ne(followUps.deletedBy, followUps.authorId)]
      : []),
    ...(options.removedByOthers === false ? [eq(followUps.deletedBy, followUps.authorId)] : []),
    ...(options.deletedSince === undefined
      ? []
      : [gte(followUps.deletedAt, new Date(options.deletedSince))]),
  ];
  const filter = and(...conditions);

  /*
   * Outstanding notes first, then earliest due.
   *
   * `nulls first` on doneAt is deliberate: Postgres sorts NULLs last in ASC,
   * which would sink every outstanding note below the resolved ones - exactly
   * backwards for the actionable list. dueDate keeps the default nulls-last,
   * so an undated note does not push a dated one down. The removed-notes view
   * is an audit trail, so it reads newest removal first. The id settles a
   * tie, so rows that sort alike keep one order from page to page.
   */
  const order =
    options.deleted === true
      ? [desc(followUps.deletedAt), asc(followUps.createdAt), asc(followUps.id)]
      : [
          sql`${followUps.doneAt} asc nulls first`,
          asc(followUps.dueDate),
          asc(followUps.createdAt),
          asc(followUps.id),
        ];

  const rows = await selectFollowUps(db)
    .where(filter)
    .orderBy(...order)
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(followUps)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the follow-up count").total };
}

/* A removed note is gone to everyone who would change it. */
export async function getFollowUp(db: Database, id: string): Promise<FollowUpRow> {
  const rows = await selectFollowUps(db)
    .where(and(eq(followUps.id, id), liveFollowUp))
    .limit(1);
  const found = rows[0];
  if (!found) {
    throw new NotFoundError("No such follow-up.");
  }
  return found;
}

/*
 * A member's suggestion would only repeat what an unresolved listed note
 * already asks for. A pending suggestion is the other open note; the partial
 * unique index refuses a second one, so two members suggesting at once
 * cannot both succeed and no read is needed for it.
 *
 * An admin's note beside a pending suggestion would leave that suggestion
 * waiting for a household already listed, and dismissing it then tells its
 * author it was declined when it was not. So the admin adds the suggestion
 * instead.
 */
async function hasOpenNote(
  db: Database,
  householdId: string,
  status: FollowUpStatus,
): Promise<boolean> {
  const found = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.householdId, householdId),
        liveFollowUp,
        eq(followUps.status, status),
        isNull(followUps.doneAt),
      ),
    )
    .limit(1);
  return found.length > 0;
}

/*
 * Held until the write commits. Every write that can open a note at a
 * household takes it first, so what a check there finds still holds when the
 * write lands. Without it an admin adding the household and a member
 * suggesting it at once each find nothing and both write, leaving it listed
 * with a suggestion waiting beside it.
 */
async function lockHousehold(tx: Database, householdId: string): Promise<void> {
  const found = await tx
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for("update");
  if (found.length === 0) {
    throw new NotFoundError("No such household.");
  }
}

export type NewFollowUp = {
  householdId: string;
  visitId?: string | null | undefined;
  note: string;
  dueDate?: string | null | undefined;
};

/*
 * A blank note is refused before the transaction opens, so it reads, locks
 * and writes nothing; what is stored is the note trimmed.
 */
export async function createFollowUp(
  db: Database,
  input: NewFollowUp,
  actor: Actor,
): Promise<FollowUpRow> {
  const note = requireText(input.note, "/note");
  return db.transaction((tx) => insertFollowUp(tx, { ...input, note }, actor));
}

async function insertFollowUp(
  db: Database,
  input: NewFollowUp,
  actor: Actor,
): Promise<FollowUpRow> {
  await lockHousehold(db, input.householdId);

  if (input.visitId != null) {
    const visit = await db
      .select({ householdId: visits.householdId })
      .from(visits)
      .where(eq(visits.id, input.visitId))
      .limit(1);

    const found = visit[0];
    if (!found) {
      throw new NotFoundError("No such visit.");
    }
    if (found.householdId !== input.householdId) {
      // A note anchored to a visit at another door would read as nonsense.
      throw new NotFoundError("That visit belongs to a different household.");
    }
  }

  const listed = actor.role === "admin";
  if (listed && (await hasOpenNote(db, input.householdId, "suggested"))) {
    throw new ConflictError("follow_up_exists", PENDING_MESSAGE);
  }
  if (!listed && (await hasOpenNote(db, input.householdId, "listed"))) {
    throw new ConflictError("follow_up_exists", EXISTS_MESSAGE);
  }

  const now = new Date();
  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(followUps)
      .values({
        householdId: input.householdId,
        visitId: input.visitId ?? null,
        note: input.note,
        dueDate: input.dueDate == null ? null : new Date(input.dueDate),
        authorId: actor.id,
        status: listed ? "listed" : "suggested",
        listedAt: listed ? now : null,
        listedBy: listed ? actor.id : null,
      })
      .returning({ id: followUps.id });
  } catch (error) {
    if (isConstraintViolation(error, ONE_OPEN_SUGGESTION)) {
      throw new ConflictError("follow_up_exists", EXISTS_MESSAGE);
    }
    throw error;
  }

  return getFollowUp(db, firstOrThrow(inserted, "the follow-up insert").id);
}

export type FollowUpChanges = {
  note?: string | undefined;
  dueDate?: string | null | undefined;
  done?: boolean | undefined;
  markedByVisit?: string | undefined;
  status?: "listed" | undefined;
};

/*
 * Resolving is not editing. Whether the thing got done is a fact about the
 * household, and the member who did it is exactly who should record it. A
 * body that resolves and also rewrites is judged as the rewrite.
 */
function isEdit(changes: FollowUpChanges): boolean {
  return changes.note !== undefined || changes.dueDate !== undefined;
}

/*
 * What a member may do, in the order the contract promises: 403 for a right
 * they never have, then 409 for one they have only inside the follow-up
 * session whose list the note is on.
 */
async function assertMemberMayUpdate(
  db: Database,
  existing: FollowUpRow,
  changes: FollowUpChanges,
  actor: Actor,
): Promise<void> {
  if (changes.status !== undefined) {
    throw new ForbiddenError("Only an admin can add a household to the follow-up list.");
  }
  const own = existing.authorId === actor.id;

  if (existing.status === "suggested") {
    // A suggestion is its author's until an admin acts on it.
    if (!own) {
      throw new ForbiddenError("You can only change your own suggestions.");
    }
    if (changes.done !== undefined) {
      throw new ConflictError(
        "conflict",
        "A suggestion can be marked done only once an admin adds it to the follow-up list.",
      );
    }
    return;
  }

  // The words belong to whoever wrote them.
  if (isEdit(changes) && !own) {
    throw new ForbiddenError("You can only change the wording of your own follow-ups.");
  }
  if (!(await isNoteOnActiveRevisitList(db, existing.id))) {
    throw new ConflictError(
      "not_on_follow_up_list",
      "You can change this only during a follow-up session that includes this household.",
    );
  }
}

/*
 * The note, read under a row lock held until the change commits. Who may
 * change a note depends on its state, so a check must still hold when the
 * write lands: an author withdrawing a suggestion while an admin lists it
 * would otherwise remove a listed note, which only an admin may do. Whoever
 * locks second reads what the first committed.
 *
 * Its household is locked first, as a new note's is, and always in that
 * order so two writers never wait on each other: an admin listing a
 * suggestion while a member suggests the same door again would otherwise
 * leave it listed with a fresh suggestion waiting. A note never changes
 * household, so where to lock can be read before locking.
 */
async function lockFollowUp(tx: Database, id: string): Promise<FollowUpRow> {
  const { householdId } = await getFollowUp(tx, id);
  await lockHousehold(tx, householdId);
  await tx.select({ id: followUps.id }).from(followUps).where(eq(followUps.id, id)).for("update");
  return getFollowUp(tx, id);
}

/*
 * Undo reopens what a save marked done and nothing since. A stale Saved line
 * must not reopen a note someone has reopened and marked done again meanwhile,
 * as a stale second "done" never takes the credit (D-35-8). A note already
 * owed passes: the undo has nothing left to do.
 */
async function assertStillMarkedBy(
  db: Database,
  existing: FollowUpRow,
  visitId: string,
  actor: Actor,
): Promise<void> {
  if (existing.doneAt === null) return;
  const { doneVisitId } = firstOrThrow(
    await db
      .select({ doneVisitId: followUps.doneVisitId })
      .from(followUps)
      .where(eq(followUps.id, existing.id)),
    "follow-up",
  );
  if (doneVisitId === visitId) return;
  const who = existing.doneById === actor.id ? "You" : firstName(existing.doneByName);
  throw new ConflictError(
    "conflict",
    `${who} marked it done again after this visit was saved, so it stays done.`,
  );
}

export async function updateFollowUp(
  db: Database,
  id: string,
  changes: FollowUpChanges,
  actor: Actor,
): Promise<FollowUpRow> {
  /* As a new note's: refused before anything is read or locked. */
  const checked =
    changes.note === undefined ? changes : { ...changes, note: requireText(changes.note, "/note") };
  return db.transaction((tx) => applyUpdate(tx, id, checked, actor));
}

async function applyUpdate(
  db: Database,
  id: string,
  changes: FollowUpChanges,
  actor: Actor,
): Promise<FollowUpRow> {
  if (changes.markedByVisit !== undefined && changes.done !== false) {
    throw new ValidationError("Invalid request body.", [
      { path: "/markedByVisit", message: "Send it only with done: false." },
    ]);
  }
  const existing = await lockFollowUp(db, id);

  if (actor.role === "admin") {
    const promoting = changes.status === "listed";
    if (changes.done !== undefined && existing.status === "suggested" && !promoting) {
      throw new ConflictError("conflict", "Add it to the follow-up list before marking it done.");
    }
  } else {
    await assertMemberMayUpdate(db, existing, changes, actor);
  }
  if (changes.markedByVisit !== undefined) {
    await assertStillMarkedBy(db, existing, changes.markedByVisit, actor);
  }

  const now = new Date();
  /*
   * Reopening owes the door again, and an owed note beside a waiting
   * suggestion is the state D-117-8 refuses: dismissing the suggestion would
   * then tell its author it was declined when it was not. So an admin's
   * reopen lists the suggestion with it, and a member's waits for an admin.
   * Read under the household lock, so a suggestion sent at the same moment
   * is either seen here or refused for the reopened note.
   */
  const reopening = changes.done === false && existing.doneAt !== null;
  if (reopening && existing.waitingSuggestionId !== null) {
    if (actor.role !== "admin") {
      throw new ConflictError(
        "follow_up_exists",
        waitingSentence({
          name: existing.waitingByName,
          mine: existing.waitingById === actor.id,
        }),
      );
    }
    await db
      .update(followUps)
      .set({ status: "listed", listedAt: now, listedBy: actor.id, updatedAt: now })
      .where(eq(followUps.id, existing.waitingSuggestionId));
  }

  const values: Record<string, unknown> = { updatedAt: now };
  if (changes.note !== undefined) values["note"] = changes.note;
  if (changes.dueDate !== undefined) {
    values["dueDate"] = changes.dueDate == null ? null : new Date(changes.dueDate);
  }
  if (changes.status === "listed" && existing.status === "suggested") {
    // Promoting twice changes nothing: the first admin to list it keeps it.
    values["status"] = "listed";
    values["listedAt"] = now;
    values["listedBy"] = actor.id;
  }
  if (changes.done === true) {
    /*
     * Records who closed it, not just that it closed - and only the first
     * time. A second "done" from a stale screen or a quick re-tap must not
     * take the credit from whoever resolved it. Coalesce in the UPDATE itself,
     * so two members resolving at once cannot both win.
     */
    values["doneAt"] = sql`coalesce(${followUps.doneAt}, ${now})`;
    values["doneBy"] = sql`coalesce(${followUps.doneBy}, ${actor.id})`;
  }
  if (changes.done === false) {
    values["doneAt"] = null;
    values["doneBy"] = null;
    // Also how a client undoes what recording a visit marked done.
    values["doneVisitId"] = null;
  }

  await db.update(followUps).set(values).where(eq(followUps.id, id));
  return getFollowUp(db, id);
}

/*
 * Never removes the row. An admin dismisses a suggestion or takes a note off
 * the list; a member may only withdraw their own suggestion. The reason is
 * required (the contract refuses a blank one) and is shown to the author of
 * a note someone else removed, and to admins.
 */
export function removeFollowUp(
  db: Database,
  id: string,
  actor: Actor,
  reason: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const existing = await lockFollowUp(tx, id);

    if (actor.role !== "admin") {
      if (existing.status === "listed") {
        throw new ForbiddenError("Only an admin can take a household off the follow-up list.");
      }
      if (existing.authorId !== actor.id) {
        throw new ForbiddenError("You can only withdraw your own suggestions.");
      }
    }

    await tx
      .update(followUps)
      .set({ deletedAt: new Date(), deletedBy: actor.id, deleteReason: reason.trim() })
      .where(eq(followUps.id, id));
  });
}
