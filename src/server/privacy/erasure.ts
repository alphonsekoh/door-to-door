import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accounts,
  authSessions,
  followUps,
  households,
  signIns,
  users,
  verificationTokens,
  visits,
} from "@/db/schema";
import { sameUuid } from "@/lib/uuid";
import { firstOrThrow } from "@/server/db-utils";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import { lockAccountChange } from "@/server/users/service";

/*
 * Erasing personal data (#279), the exception to D-117-4, D-117-33 and D-07-1
 * that D-273-11 makes. Both functions run inside the caller's transaction, so
 * what is erased and the record that it was commit together.
 */

/*
 * A household keeps only its row: the unit and when it was erased. That is
 * what lets sync refuse a record made before the erasure, and what leaves
 * session picks and blocks untouched.
 *
 * Locks as a follow-up write, an amend and sync already do: the household,
 * then its notes, then its visits. A write waiting on the household finds the
 * erasure committed; an erasure waiting behind a write deletes what it stored.
 */
export async function eraseHousehold(
  tx: Database,
  id: string,
  now: Date,
  /* Sync refuses records saved before this; the retention job passes its cutoff. */
  erasedAt: Date = now,
): Promise<void> {
  const locked = await tx
    .select({ id: households.id, erasedAt: households.erasedAt })
    .from(households)
    .where(eq(households.id, id))
    .for("update");
  if (locked.length === 0) {
    throw new NotFoundError("No such household.");
  }
  const previous = locked[0]?.erasedAt ?? null;
  // Removed notes and their reasons too: erasure is not a soft delete.
  await tx.delete(followUps).where(eq(followUps.householdId, id));
  // Their teammate snapshots go with them (cascade).
  await tx.delete(visits).where(eq(visits.householdId, id));
  await tx
    .update(households)
    .set({
      name: null,
      contact: null,
      religion: null,
      contactWithdrawnAt: null,
      // Never backward over an earlier on-request erasure.
      erasedAt: previous !== null && previous > erasedAt ? previous : erasedAt,
      updatedAt: now,
    })
    .where(eq(households.id, id));
}

/*
 * A unit that was erased and has had nothing recorded since holds nothing to
 * erase or follow up. Any visit left at an erased unit was recorded after it.
 */
export async function assertHoldsSomething(
  tx: Database,
  householdId: string,
  household: { erasedAt: Date | null },
): Promise<void> {
  if (household.erasedAt === null) return;
  const since = await tx
    .select({ id: visits.id })
    .from(visits)
    .where(eq(visits.householdId, householdId))
    .limit(1);
  if (since.length === 0) {
    throw new ConflictError(
      "household_erased",
      "This unit's records were erased and nothing has been recorded there since.",
    );
  }
}

export const erasedEmail = (id: string) => `erased-${id.toLowerCase()}@erased.invalid`;

/*
 * Anonymises the account in place: the visits, notes and teams that name it
 * stay, under no name. Judged as an admin's deactivation is, on the same
 * locked rows: nobody erases their own account here, nor the last active
 * admin. `actorId` is null for the retention job, which has no caller.
 *
 * An approved account is deactivated with it, which is what ends its use of
 * the app; the sign-ins go in this transaction, after the locks, as
 * deactivating does (#125).
 */
export async function eraseAccount(
  tx: Database,
  id: string,
  actorId: string | null,
  now: Date,
): Promise<void> {
  const { locked, current } = await lockAccountChange(tx, id);

  if (actorId !== null && sameUuid(id, actorId)) {
    throw new ConflictError("conflict", "You cannot erase your own account.");
  }
  const wasActiveAdmin = current.role === "admin" && current.deactivatedAt === null;
  if (wasActiveAdmin && !locked.some((row) => !sameUuid(row.id, id))) {
    throw new ConflictError("conflict", "The team needs at least one active admin.");
  }

  const { email } = firstOrThrow(
    await tx.select({ email: users.email }).from(users).where(eq(users.id, id)),
    "the account's email",
  );
  await tx
    .update(users)
    .set({
      name: null,
      image: null,
      passwordHash: null,
      emailVerified: null,
      email: erasedEmail(current.id),
      deactivatedAt: current.approval === "approved" ? (current.deactivatedAt ?? now) : null,
      erasedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, id));
  await tx.delete(accounts).where(eq(accounts.userId, id));
  await tx.delete(authSessions).where(eq(authSessions.userId, id));
  await tx.delete(signIns).where(eq(signIns.userId, id));
  await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, email));
}
