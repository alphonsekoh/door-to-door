import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel, Religion } from "@/db/schema";
import { blocks, households, outingSessions, sessionBlocks, users, visits } from "@/db/schema";
import type { Clock } from "@/lib/clock";
import { assertNotInFuture } from "@/server/visits/clock-rules";
import { firstOrThrow } from "@/server/db-utils";
import {
  attachTeams,
  autoJoin,
  canAmend,
  stampVisit,
  teamIdFor,
  type TeamStamp,
} from "@/server/teams/access";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/http/errors";

/*
 * Households and visits - the part of the model everything else exists to
 * serve.
 *
 * A household is a unit in a block, identified by (block_id, unit_number).
 * Recording a visit upserts it, so the second knock on #05-123 in August finds
 * the household created in March rather than making a new one. That is what
 * makes history accumulate at all.
 */

export type HouseholdIdentity = {
  name?: string | null | undefined;
  contact?: string | null | undefined;
  religion?: Religion | null | undefined;
};

/*
 * Identity fields update only when a non-null value is supplied. A later visit
 * that learns nothing must not erase what an earlier one recorded - the member
 * who got a name in March should not lose it because nobody answered in June.
 */
function knownFieldsOnly(identity: HouseholdIdentity): Record<string, unknown> {
  const known: Record<string, unknown> = {};
  if (identity.name != null) known["name"] = identity.name;
  if (identity.contact != null) known["contact"] = identity.contact;
  if (identity.religion != null) known["religion"] = identity.religion;
  return known;
}

export type HouseholdRow = {
  id: string;
  blockId: string;
  unitNumber: string;
  name: string | null;
  contact: string | null;
  religion: Religion | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function upsertHousehold(
  db: Database,
  input: { blockId: string; unitNumber: string } & HouseholdIdentity,
): Promise<HouseholdRow> {
  const unitNumber = input.unitNumber.trim();
  const known = knownFieldsOnly(input);

  const inserted = await db
    .insert(households)
    .values({ blockId: input.blockId, unitNumber, ...known })
    .onConflictDoUpdate({
      target: [households.blockId, households.unitNumber],
      set:
        Object.keys(known).length > 0
          ? { ...known, updatedAt: new Date() }
          : // Nothing new learned: touch nothing, so updatedAt stays honest.
            { unitNumber },
    })
    .returning();

  return firstOrThrow(inserted, "the household upsert");
}

export type VisitBase = {
  id: string;
  householdId: string;
  sessionId: string;
  teamId: string | null;
  interestLevel: InterestLevel;
  description: string;
  clientCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  memberId: string;
  memberName: string | null;
  memberImage: string | null;
};

/* A visit as the API shows it: the stamped team and its snapshot attached. */
export type VisitRow = VisitBase & { team: TeamStamp | null };

export const visitColumns = {
  id: visits.id,
  householdId: visits.householdId,
  sessionId: visits.sessionId,
  teamId: visits.teamId,
  interestLevel: visits.interestLevel,
  description: visits.description,
  clientCreatedAt: visits.clientCreatedAt,
  createdAt: visits.createdAt,
  updatedAt: visits.updatedAt,
  memberId: users.id,
  memberName: users.name,
  memberImage: users.image,
};

async function requireActiveSessionWithBlock(db: Database, blockId: string): Promise<string> {
  const active = await db
    .select({ id: outingSessions.id })
    .from(outingSessions)
    .where(eq(outingSessions.status, "active"))
    .limit(1);

  const session = active[0];
  if (!session) {
    throw new ConflictError("session_not_active", "No session is active.");
  }

  const attached = await db
    .select({ blockId: sessionBlocks.blockId })
    .from(sessionBlocks)
    .where(and(eq(sessionBlocks.sessionId, session.id), eq(sessionBlocks.blockId, blockId)))
    .limit(1);

  if (attached.length === 0) {
    throw new ConflictError("conflict", "That block is not part of the active session.");
  }
  return session.id;
}

export async function getVisit(db: Database, id: string): Promise<VisitRow> {
  const rows = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(eq(visits.id, id))
    .limit(1);

  const visit = rows[0];
  if (!visit) {
    throw new NotFoundError("No such visit.");
  }
  return firstOrThrow(await attachTeams(db, [visit]), "the visit's team");
}

export async function createVisit(
  db: Database,
  input: {
    id: string;
    blockId: string;
    unitNumber: string;
    interestLevel: InterestLevel;
    description?: string | undefined;
    clientCreatedAt?: string | undefined;
    memberId: string;
  } & HouseholdIdentity,
  clock: Clock,
): Promise<VisitRow> {
  if (input.clientCreatedAt !== undefined) {
    assertNotInFuture(new Date(input.clientCreatedAt), clock);
  }

  const blockExists = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(eq(blocks.id, input.blockId))
    .limit(1);

  if (blockExists.length === 0) {
    throw new NotFoundError("No such block.");
  }

  const memberExists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.memberId))
    .limit(1);

  if (memberExists.length === 0) {
    /* Only reachable when an admin names someone: a caller's own id comes
       from a verified session. A bare insert would fail on the foreign key
       with a constraint name instead of a usable message. */
    throw new NotFoundError("No such member.");
  }

  const sessionId = await requireActiveSessionWithBlock(db, input.blockId);

  /*
   * One transaction, so a duplicate id rolls the household upsert back and a
   * visit never exists without the stamp and snapshot that describe it.
   */
  await db.transaction(async (tx) => {
    const household = await upsertHousehold(tx, {
      blockId: input.blockId,
      unitNumber: input.unitNumber,
      name: input.name,
      contact: input.contact,
      religion: input.religion,
    });

    /*
     * The team is the AUTHOR's, so an admin recording on someone's behalf
     * stamps that member's team, not their own.
     */
    const teamId = await teamIdFor(tx, input.memberId, sessionId);

    const inserted = await tx
      .insert(visits)
      .values({
        id: input.id,
        householdId: household.id,
        sessionId,
        memberId: input.memberId,
        teamId,
        interestLevel: input.interestLevel,
        description: input.description ?? "",
        ...(input.clientCreatedAt === undefined
          ? {}
          : { clientCreatedAt: new Date(input.clientCreatedAt) }),
      })
      // The client generates the id, so a repeat is a genuine duplicate here;
      // replaying a queued write is what /visits/sync is for (#21).
      .onConflictDoNothing()
      .returning({ id: visits.id });

    if (inserted.length === 0) {
      throw new ConflictError("conflict", "A visit with that id already exists.");
    }
    await stampVisit(tx, input.id, teamId, input.memberId);
    await autoJoin(tx, sessionId, input.memberId);
  });

  return getVisit(db, input.id);
}

export async function updateVisit(
  db: Database,
  id: string,
  changes: {
    interestLevel?: InterestLevel | undefined;
    description?: string | undefined;
  } & HouseholdIdentity,
  actor: { id: string; role: "admin" | "member" },
): Promise<VisitRow> {
  const visit = await getVisit(db, id);

  if (!(await canAmend(db, actor, visit))) {
    throw new ForbiddenError("You can only amend your own records, or your team's.");
  }

  if (actor.role !== "admin") {
    const session = await db
      .select({ status: outingSessions.status })
      .from(outingSessions)
      .where(eq(outingSessions.id, visit.sessionId))
      .limit(1);

    if (firstOrThrow(session, "the session lookup").status !== "active") {
      /*
       * An admin can reopen the session to restore access, which is why this
       * is a conflict rather than a flat refusal.
       */
      throw new ConflictError(
        "session_not_active",
        "That session has ended. Ask an admin to reopen it.",
      );
    }
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.interestLevel !== undefined) values["interestLevel"] = changes.interestLevel;
  if (changes.description !== undefined) values["description"] = changes.description;

  await db.update(visits).set(values).where(eq(visits.id, id));

  const known = knownFieldsOnly(changes);
  if (Object.keys(known).length > 0) {
    await db
      .update(households)
      .set({ ...known, updatedAt: new Date() })
      .where(eq(households.id, visit.householdId));
  }

  return getVisit(db, id);
}
