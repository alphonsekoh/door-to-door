import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { followUps, households, visits } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import { ForbiddenError, NotFoundError } from "@/server/http/errors";
import { type FollowUpRow, selectFollowUps } from "@/server/visits/queries";

/*
 * Follow-up notes.
 *
 * They attach to the household, not the session, so a promise made in January
 * is still there when someone knocks on that door in August. That is the whole
 * reason the feature exists, and it is why nothing here is scoped to a session.
 */

export type ListFollowUpOptions = {
  householdId?: string | undefined;
  authorId?: string | undefined;
  outstanding?: boolean | undefined;
  dueBefore?: string | undefined;
  limit: number;
  offset: number;
};

export async function listFollowUps(
  db: Database,
  options: ListFollowUpOptions,
): Promise<{ rows: FollowUpRow[]; total: number }> {
  const conditions = [
    ...(options.householdId === undefined ? [] : [eq(followUps.householdId, options.householdId)]),
    ...(options.authorId === undefined ? [] : [eq(followUps.authorId, options.authorId)]),
    ...(options.outstanding === true ? [isNull(followUps.doneAt)] : []),
    ...(options.outstanding === false ? [sql`${followUps.doneAt} is not null`] : []),
    ...(options.dueBefore === undefined
      ? []
      : [lt(followUps.dueDate, new Date(options.dueBefore))]),
  ];
  const filter = conditions.length > 0 ? and(...conditions) : undefined;

  /*
   * Outstanding notes first, then earliest due.
   *
   * `nulls first` on doneAt is deliberate: Postgres sorts NULLs last in ASC,
   * which would sink every outstanding note below the resolved ones - exactly
   * backwards for the actionable list. dueDate keeps the default nulls-last,
   * so an undated note does not push a dated one down.
   */
  const rows = await selectFollowUps(db)
    .where(filter)
    .orderBy(
      sql`${followUps.doneAt} asc nulls first`,
      asc(followUps.dueDate),
      asc(followUps.createdAt),
    )
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(followUps)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the follow-up count").total };
}

export async function getFollowUp(db: Database, id: string): Promise<FollowUpRow> {
  const rows = await selectFollowUps(db).where(eq(followUps.id, id)).limit(1);
  const found = rows[0];
  if (!found) {
    throw new NotFoundError("No such follow-up.");
  }
  return found;
}

export async function createFollowUp(
  db: Database,
  input: {
    householdId: string;
    visitId?: string | null | undefined;
    note: string;
    dueDate?: string | null | undefined;
    authorId: string;
  },
): Promise<FollowUpRow> {
  const household = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, input.householdId))
    .limit(1);

  if (household.length === 0) {
    throw new NotFoundError("No such household.");
  }

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

  const inserted = await db
    .insert(followUps)
    .values({
      householdId: input.householdId,
      visitId: input.visitId ?? null,
      note: input.note.trim(),
      dueDate: input.dueDate == null ? null : new Date(input.dueDate),
      authorId: input.authorId,
    })
    .returning({ id: followUps.id });

  return getFollowUp(db, firstOrThrow(inserted, "the follow-up insert").id);
}

/*
 * Editing a note - its text or its due date - is restricted to the author or
 * an admin. The words belong to whoever wrote them.
 */
function assertMayEdit(
  followUp: FollowUpRow,
  actor: { id: string; role: "admin" | "member" },
): void {
  if (actor.role !== "admin" && followUp.authorId !== actor.id) {
    throw new ForbiddenError("You can only change your own follow-ups.");
  }
}

/*
 * Resolving is not editing. Whether the thing got done is a fact about the
 * household, and the member who did it is exactly who should record it - a
 * note written by one member and acted on by another would otherwise sit on
 * the outstanding list until its author happened to notice. doneBy keeps it
 * attributable.
 */
function isResolutionOnly(changes: Record<string, unknown>): boolean {
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((key) => key === "done");
}

export async function updateFollowUp(
  db: Database,
  id: string,
  changes: {
    note?: string | undefined;
    dueDate?: string | null | undefined;
    done?: boolean | undefined;
  },
  actor: { id: string; role: "admin" | "member" },
): Promise<FollowUpRow> {
  const existing = await getFollowUp(db, id);
  if (!isResolutionOnly(changes)) {
    assertMayEdit(existing, actor);
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.note !== undefined) values["note"] = changes.note.trim();
  if (changes.dueDate !== undefined) {
    values["dueDate"] = changes.dueDate == null ? null : new Date(changes.dueDate);
  }
  if (changes.done === true) {
    /*
     * Records who closed it, not just that it closed - and only the first
     * time. A second "done" from a stale screen or a quick re-tap must not
     * take the credit from whoever resolved it. Coalesce in the UPDATE itself,
     * so two members resolving at once cannot both win.
     */
    values["doneAt"] = sql`coalesce(${followUps.doneAt}, ${new Date()})`;
    values["doneBy"] = sql`coalesce(${followUps.doneBy}, ${actor.id})`;
  }
  if (changes.done === false) {
    values["doneAt"] = null;
    values["doneBy"] = null;
  }

  await db.update(followUps).set(values).where(eq(followUps.id, id));
  return getFollowUp(db, id);
}

export async function deleteFollowUp(
  db: Database,
  id: string,
  actor: { id: string; role: "admin" | "member" },
): Promise<void> {
  assertMayEdit(await getFollowUp(db, id), actor);
  await db.delete(followUps).where(eq(followUps.id, id));
}
