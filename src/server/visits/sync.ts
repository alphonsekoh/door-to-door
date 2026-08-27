import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel } from "@/db/schema";
import { blocks, outingSessions, sessionBlocks, visits } from "@/db/schema";
import { and } from "drizzle-orm";
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

async function resolveSession(db: Database, item: SyncItem): Promise<string> {
  if (item.sessionId !== undefined) {
    const found = await db
      .select({ id: outingSessions.id, status: outingSessions.status })
      .from(outingSessions)
      .where(eq(outingSessions.id, item.sessionId))
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
    return session.id;
  }

  const active = await db
    .select({ id: outingSessions.id })
    .from(outingSessions)
    .where(eq(outingSessions.status, "active"))
    .limit(1);

  const session = active[0];
  if (!session) {
    throw new ConflictError("session_not_active", "No session is active.");
  }
  return session.id;
}

async function applyItem(db: Database, item: SyncItem, memberId: string): Promise<SyncOutcome> {
  const blockExists = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(eq(blocks.id, item.blockId))
    .limit(1);

  if (blockExists.length === 0) {
    throw new NotFoundError("No such block.");
  }

  const existing = await db
    .select({ updatedAt: visits.updatedAt, memberId: visits.memberId })
    .from(visits)
    .where(eq(visits.id, item.id))
    .limit(1);

  const incomingUpdatedAt = new Date(item.updatedAt);
  const stored = existing[0];

  if (stored) {
    if (stored.memberId !== memberId) {
      throw new ConflictError("conflict", "That visit belongs to another member.");
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

  const sessionId = await resolveSession(db, item);

  const attached = await db
    .select({ blockId: sessionBlocks.blockId })
    .from(sessionBlocks)
    .where(and(eq(sessionBlocks.sessionId, sessionId), eq(sessionBlocks.blockId, item.blockId)))
    .limit(1);

  if (attached.length === 0) {
    throw new ConflictError("conflict", "That block is not part of the session.");
  }

  const household = await upsertHousehold(db, {
    blockId: item.blockId,
    unitNumber: item.unitNumber,
    name: item.name,
    contact: item.contact,
    religion: item.religion,
  });

  const values = {
    householdId: household.id,
    sessionId,
    memberId,
    interestLevel: item.interestLevel,
    description: item.description ?? "",
    clientCreatedAt: new Date(item.clientCreatedAt),
    updatedAt: incomingUpdatedAt,
  };

  /*
   * Upsert on the client-generated id. Two devices flushing the same queued
   * record concurrently both land here, and the row is written once.
   */
  await db
    .insert(visits)
    .values({ id: item.id, ...values })
    .onConflictDoUpdate({ target: visits.id, set: values });

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
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of items) {
    try {
      outcomes.push(await applyItem(db, item, memberId));
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
