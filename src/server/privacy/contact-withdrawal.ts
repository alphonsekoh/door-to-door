import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { households } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import type { HouseholdRow } from "@/server/visits/service";

/*
 * A withdrawn agreement to calls or messages (#279). A timestamp on the
 * household: anyone may mark it, since it only ever stops the team from using
 * the contact, and only an admin clears it. A later visit recording a contact
 * does not clear it; erasing the household does.
 */

/* The household locked FOR UPDATE, as every household write is. */
async function lockHousehold(tx: Database, id: string): Promise<HouseholdRow> {
  const found = await tx.select().from(households).where(eq(households.id, id)).for("update");
  const household = found[0];
  if (!household) throw new NotFoundError("No such household.");
  return household;
}

/* Marking a unit already marked keeps the first time. */
export async function markContactWithdrawn(
  db: Database,
  id: string,
  now: Date,
): Promise<HouseholdRow> {
  return db.transaction(async (tx) => {
    const household = await lockHousehold(tx, id);
    if (household.contact === null) {
      throw new ConflictError("conflict", "No contact is recorded for this unit.");
    }
    if (household.contactWithdrawnAt !== null) return household;
    const updated = await tx
      .update(households)
      .set({ contactWithdrawnAt: now })
      .where(eq(households.id, id))
      .returning();
    return firstOrThrow(updated, "the household update");
  });
}

export async function clearContactWithdrawn(db: Database, id: string): Promise<HouseholdRow> {
  return db.transaction(async (tx) => {
    const household = await lockHousehold(tx, id);
    if (household.contactWithdrawnAt === null) return household;
    const updated = await tx
      .update(households)
      .set({ contactWithdrawnAt: null })
      .where(eq(households.id, id))
      .returning();
    return firstOrThrow(updated, "the household update");
  });
}
