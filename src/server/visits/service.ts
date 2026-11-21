import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { InterestLevel, Religion, Role, SessionStatus } from "@/db/schema";
import { blocks, households, outingSessions, sessionBlocks, users, visits } from "@/db/schema";
import type { Clock } from "@/lib/clock";
import { assertNotInFuture } from "@/server/visits/clock-rules";
import { firstOrThrow } from "@/server/db-utils";
import { assertMayRecordHere, placeKey, type RevisitSession } from "@/server/follow-ups/list-rule";
import { markDoneByVisit } from "@/server/follow-ups/marked-by-visit";
import {
  attachTeams,
  autoJoin,
  canAmend,
  stampVisit,
  teamIdFor,
  type TeamStamp,
} from "@/server/teams/access";
import { compareUuids } from "@/lib/uuid";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/http/errors";
import { requireText } from "@/server/http/text";

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

type KnownIdentity = { name?: string; contact?: string; religion?: Religion };

/*
 * Identity fields update only when a non-null value is supplied. A later visit
 * that learns nothing must not erase what an earlier one recorded - the member
 * who got a name in March should not lose it because nobody answered in June.
 * Spaces alone are nothing learnt either (D-119-7).
 */
function knownFieldsOnly(identity: HouseholdIdentity): KnownIdentity {
  const known: KnownIdentity = {};
  const name = identity.name?.trim();
  const contact = identity.contact?.trim();
  if (name !== undefined && name !== "") known.name = name;
  if (contact !== undefined && contact !== "") known.contact = contact;
  if (identity.religion != null) known.religion = identity.religion;
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
  const unitNumber = requireText(input.unitNumber, "/unitNumber");
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

/* A unit a batch records at, with what it learnt there. The unit is as stored: trimmed. */
export type HouseholdPlace = { blockId: string; unitNumber: string } & HouseholdIdentity;

export type FoldedHousehold = { blockId: string; unitNumber: string } & KnownIdentity;

/*
 * One row per unit, as one statement cannot touch a row twice. Identity is
 * folded in request order, field by field, so the unit ends as recording the
 * records one at a time would leave it: a later known value wins, a blank
 * never erases. Sorted by block, then unit, so every batch locks the rows it
 * shares with another in one order.
 */
export function foldHouseholds(places: readonly HouseholdPlace[]): FoldedHousehold[] {
  const byPlace = new Map<string, FoldedHousehold>();
  for (const place of places) {
    const key = placeKey(place.blockId, place.unitNumber);
    const base = byPlace.get(key) ?? {
      blockId: place.blockId.toLowerCase(),
      unitNumber: place.unitNumber,
    };
    byPlace.set(key, { ...base, ...knownFieldsOnly(place) });
  }
  // Two rows never share both block and unit, so units never tie.
  return [...byPlace.values()].sort(
    (a, b) => compareUuids(a.blockId, b.blockId) || (a.unitNumber < b.unitNumber ? -1 : 1),
  );
}

/*
 * upsertHousehold for a batch's units in one statement: the household ids,
 * by placeKey.
 *
 * Postgres picks one lock for every row from the columns the SET names.
 * Naming unit_number, a key, makes it FOR UPDATE: the mode upsertHousehold
 * takes for a record that learns nothing, and stronger than its NO KEY
 * UPDATE for one that learns something. So a run waits wherever its records
 * would have waited alone, behind a visit not yet committed there say, and
 * never less (D-251-6). updated_at moves only when something was learnt, as
 * upsertHousehold's does.
 */
export async function upsertHouseholds(
  db: Database,
  places: readonly HouseholdPlace[],
): Promise<Map<string, string>> {
  const upserted = await db
    .insert(households)
    .values(foldHouseholds(places))
    .onConflictDoUpdate({
      target: [households.blockId, households.unitNumber],
      set: {
        unitNumber: sql`excluded.unit_number`,
        name: sql`coalesce(excluded.name, households.name)`,
        contact: sql`coalesce(excluded.contact, households.contact)`,
        religion: sql`coalesce(excluded.religion, households.religion)`,
        updatedAt: sql`case when num_nonnulls(excluded.name, excluded.contact, excluded.religion) > 0
          then now() else households.updated_at end`,
      },
    })
    .returning({
      id: households.id,
      blockId: households.blockId,
      unitNumber: households.unitNumber,
    });

  return new Map(upserted.map((row) => [placeKey(row.blockId, row.unitNumber), row.id]));
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

/*
 * A visit's first lock: its author's row, FOR SHARE, so a deactivation waits
 * for a visit that passed this check, or the visit reads what it committed.
 * SHARE because a deactivation's UPDATE does not wait for KEY SHARE, the mode
 * the foreign key already takes. First, so a visit waiting here holds nothing
 * that updateUser, which locks only user rows, could be waiting for.
 */
async function lockActiveAuthor(tx: Database, memberId: string): Promise<void> {
  const found = await tx
    .select({ deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, memberId))
    .for("share");

  const author = found[0];
  if (!author) {
    /* Only reachable when an admin names someone: a caller's own id comes
       from a verified session. A bare insert would fail on the foreign key
       with a constraint name instead of a usable message. */
    throw new NotFoundError("No such member.");
  }
  if (author.deactivatedAt !== null) {
    throw new ConflictError("conflict", "That member's account is deactivated.");
  }
}

/*
 * Locks the active session's row (FOR KEY SHARE) right after the author's,
 * before any household. Changing a follow-up session's households also locks
 * the session row before its households (FOR UPDATE), so a record and a
 * household change wait for each other in one order. The checks that follow
 * then read what a remove committed, and a remove sees this visit.
 */
async function requireActiveSessionWithBlock(
  db: Database,
  blockId: string,
): Promise<RevisitSession> {
  const active = await db
    .select({
      id: outingSessions.id,
      kind: outingSessions.kind,
      startedAt: outingSessions.startedAt,
    })
    .from(outingSessions)
    .where(eq(outingSessions.status, "active"))
    .limit(1)
    .for("key share");

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
  return session;
}

/* Only ever reads back a visit the caller has just stored or found; none is ever deleted. */
export async function getVisit(db: Database, id: string): Promise<VisitRow> {
  const rows = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(eq(visits.id, id))
    .limit(1);

  const visit = firstOrThrow(rows, "the visit just written");
  return firstOrThrow(await attachTeams(db, [visit]), "the visit's team");
}

/* getVisit for many ids at once, keyed by id in lower case; an id not stored is absent. */
export async function getVisits(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, VisitRow>> {
  const rows = await db
    .select(visitColumns)
    .from(visits)
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(inArray(visits.id, [...ids]));

  return new Map((await attachTeams(db, rows)).map((visit) => [visit.id, visit]));
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
  // Who is recording, which is not the author when an admin records for someone.
  actor: { role: Role },
): Promise<VisitRow> {
  // Before anything is read: a blank unit is refused for every caller alike.
  const unitNumber = requireText(input.unitNumber, "/unitNumber");
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

  /*
   * One transaction, so a duplicate id rolls the household upsert back and a
   * visit never exists without the stamp and snapshot that describe it. Who
   * may author it and where it may be recorded are judged inside it, under
   * the author's lock and then the session's.
   */
  await db.transaction(async (tx) => {
    await lockActiveAuthor(tx, input.memberId);
    const session = await requireActiveSessionWithBlock(tx, input.blockId);
    await assertMayRecordHere(tx, actor, session, input.blockId, unitNumber);
    const sessionId = session.id;

    const household = await upsertHousehold(tx, {
      blockId: input.blockId,
      unitNumber,
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
    await markDoneByVisit(tx, session, household.id, input.id, input.memberId);
  });

  return getVisit(db, input.id);
}

type LockedVisit = {
  memberId: string;
  teamId: string | null;
  householdId: string;
  sessionStatus: SessionStatus;
};

/*
 * Locks what an amend is judged on, in the order recording and sync take
 * them (D-117-45, D-117-9): the visit's session FOR KEY SHARE, so an end
 * waits for the amend or the amend reads what it committed, then the
 * household FOR UPDATE and the visit FOR NO KEY UPDATE. A stored visit never
 * changes household or session, so where to lock is read before locking.
 *
 * NO KEY UPDATE, as sync's amend takes it: an amend changes no key, and
 * FOR UPDATE would block the KEY SHARE that disbanding the team takes on its
 * visits after deleting the membership canAmend then waits to read - a
 * deadlock, where this way the disband is refused at once.
 */
async function lockForAmend(tx: Database, id: string): Promise<LockedVisit> {
  const found = await tx
    .select({ householdId: visits.householdId, sessionId: visits.sessionId })
    .from(visits)
    .where(eq(visits.id, id))
    .limit(1);
  const place = found[0];
  if (!place) {
    throw new NotFoundError("No such visit.");
  }

  const session = await tx
    .select({ status: outingSessions.status })
    .from(outingSessions)
    .where(eq(outingSessions.id, place.sessionId))
    .for("key share");
  await tx
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, place.householdId))
    .for("update");
  const visit = await tx
    .select({ memberId: visits.memberId, teamId: visits.teamId })
    .from(visits)
    .where(eq(visits.id, id))
    .for("no key update");

  return {
    ...firstOrThrow(visit, "the visit lock"),
    householdId: place.householdId,
    sessionStatus: firstOrThrow(session, "the session lock").status,
  };
}

/*
 * One transaction, so the visit and its household's identity change together
 * or not at all, and the rights are judged on the locked rows: a teammate
 * removed, or the session ended, while the amend waited is seen. An amend
 * never marks a follow-up done (D-117-65); only a new visit does.
 */
export async function updateVisit(
  db: Database,
  id: string,
  changes: {
    interestLevel?: InterestLevel | undefined;
    description?: string | undefined;
  } & HouseholdIdentity,
  actor: { id: string; role: "admin" | "member" },
): Promise<VisitRow> {
  await db.transaction(async (tx) => {
    const visit = await lockForAmend(tx, id);

    if (!(await canAmend(tx, actor, visit))) {
      throw new ForbiddenError("You can only amend your own records, or your team's.");
    }

    if (actor.role !== "admin" && visit.sessionStatus !== "active") {
      /*
       * An admin can reopen the session to restore access, which is why this
       * is a conflict rather than a flat refusal.
       */
      throw new ConflictError(
        "session_not_active",
        "That session has ended. Ask an admin to reopen it.",
      );
    }

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (changes.interestLevel !== undefined) values["interestLevel"] = changes.interestLevel;
    if (changes.description !== undefined) values["description"] = changes.description;

    await tx.update(visits).set(values).where(eq(visits.id, id));

    const known = knownFieldsOnly(changes);
    if (Object.keys(known).length > 0) {
      await tx
        .update(households)
        .set({ ...known, updatedAt: new Date() })
        .where(eq(households.id, visit.householdId));
    }
  });

  return getVisit(db, id);
}
