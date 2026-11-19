import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  blocks,
  followUps,
  households,
  outingSessions,
  sessionBlocks,
  users,
  visits,
} from "@/db/schema";
import type { SessionKind, SessionStatus } from "@/db/schema";
import { distinctUuidsInOrder } from "@/lib/uuid";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { onRevisitList } from "@/server/follow-ups/list-rule";
import { ConflictError, NotFoundError, ValidationError } from "@/server/http/errors";
import {
  type LockedSession,
  blockHasSessionVisits,
  lockSession,
  pickHouseholds,
} from "@/server/sessions/households";

/*
 * Session lifecycle.
 *
 * Only one session may be active app-wide, enforced by a partial unique index.
 * Every transition therefore has to treat that constraint as a real outcome
 * rather than an assertion: two admins pressing Start at the same moment is a
 * race the application layer alone cannot close.
 */

export const ACTIVE_SESSION_CONSTRAINT = "one_active_session_idx";

export const isActiveSessionClash = (error: unknown): boolean =>
  isConstraintViolation(error, ACTIVE_SESSION_CONSTRAINT);

export type SessionRow = {
  id: string;
  title: string;
  kind: SessionKind;
  status: SessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  createdById: string;
  createdByName: string | null;
  createdByImage: string | null;
};

const sessionColumns = {
  id: outingSessions.id,
  title: outingSessions.title,
  kind: outingSessions.kind,
  status: outingSessions.status,
  startedAt: outingSessions.startedAt,
  endedAt: outingSessions.endedAt,
  createdAt: outingSessions.createdAt,
  createdById: users.id,
  createdByName: users.name,
  createdByImage: users.image,
};

export async function listSessions(
  db: Database,
  options: { limit: number; offset: number; status?: SessionStatus; kind?: SessionKind },
): Promise<{ rows: SessionRow[]; total: number }> {
  const filter = and(
    options.status === undefined ? undefined : eq(outingSessions.status, options.status),
    options.kind === undefined ? undefined : eq(outingSessions.kind, options.kind),
  );

  const rows = await db
    .select(sessionColumns)
    .from(outingSessions)
    .innerJoin(users, eq(users.id, outingSessions.createdBy))
    .where(filter)
    /* The id keeps sessions created at one instant in one order from page to
       page (#212). */
    .orderBy(desc(outingSessions.createdAt), desc(outingSessions.id))
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outingSessions)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the session count").total };
}

export async function getSession(db: Database, id: string): Promise<SessionRow> {
  const rows = await db
    .select(sessionColumns)
    .from(outingSessions)
    .innerJoin(users, eq(users.id, outingSessions.createdBy))
    .where(eq(outingSessions.id, id))
    .limit(1);

  const session = rows[0];
  if (!session) {
    throw new NotFoundError("No such session.");
  }
  return session;
}

export type NewSession = {
  title: string;
  kind: SessionKind;
  blockIds?: string[] | undefined;
  householdIds?: string[] | undefined;
  createdBy: string;
};

/*
 * A regular session takes blocks; a follow-up session takes the households
 * it goes back to, at least one, and gets their blocks. Each refuses the
 * other's, so a client cannot build a follow-up session block by block.
 */
function assertShape(input: NewSession): void {
  const issue = (path: string, message: string) =>
    new ValidationError("Invalid request body.", [{ path, message }]);
  if (input.kind === "regular") {
    if (input.householdIds !== undefined) {
      throw issue("/householdIds", "Only a follow-up session has households.");
    }
    return;
  }
  if (input.blockIds !== undefined) {
    throw issue("/blockIds", "A follow-up session's blocks come from its households.");
  }
  if (input.householdIds === undefined) {
    throw issue("/householdIds", "Pick at least one household to visit.");
  }
}

export async function createSession(db: Database, input: NewSession): Promise<SessionRow> {
  assertShape(input);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(outingSessions)
      .values({
        title: input.title,
        kind: input.kind,
        status: "draft",
        createdBy: input.createdBy,
      })
      .returning({ id: outingSessions.id });

    const id = firstOrThrow(inserted, "the session insert").id;

    if (input.householdIds !== undefined) {
      await pickHouseholds(tx, id, input.householdIds);
    }
    if (input.blockIds && input.blockIds.length > 0) {
      await attachBlocks(tx, id, input.blockIds);
    }
    return getSession(tx, id);
  });
}

/* A follow-up session's blocks follow its households, never a hand. */
export function assertBlocksByHand(session: { kind: SessionKind }): void {
  if (session.kind === "follow_up") {
    throw new ConflictError(
      "conflict",
      "A follow-up session's blocks follow its households. Add or remove households instead.",
    );
  }
}

/*
 * Rejects unknown blocks before attaching any, so the request is all or
 * nothing. One block named in two letter cases is one block, not a missing one.
 */
export async function attachBlocks(
  db: Database,
  sessionId: string,
  blockIds: string[],
): Promise<void> {
  const unique = distinctUuidsInOrder(blockIds);
  const found = await db.select({ id: blocks.id }).from(blocks).where(inArray(blocks.id, unique));

  if (found.length !== unique.length) {
    throw new NotFoundError("One or more blocks do not exist.");
  }

  await db
    .insert(sessionBlocks)
    .values(unique.map((blockId) => ({ sessionId, blockId })))
    // Attaching a block that is already attached is a no-op, not an error.
    .onConflictDoNothing();
}

export type Transition = "start" | "end" | "reopen";

const TRANSITIONS: Record<Transition, { from: SessionStatus; to: SessionStatus; done: string }> = {
  start: { from: "draft", to: "active", done: "started" },
  end: { from: "active", to: "ended", done: "ended" },
  reopen: { from: "ended", to: "active", done: "reopened" },
};

/* Why a refused change cannot happen, as an admin who raced another reads it. */
const STATE: Record<SessionStatus, string> = {
  draft: "has not started",
  active: "is already running",
  ended: "has already ended",
};

const NOTHING_OWED =
  "Every household in this session is done or off the follow-up list, so members would find nothing to visit. Add households before starting it.";

/*
 * Whether a follow-up draft has anything on its list: a picked household
 * with a listed note still owed. Picks are sticky, so a draft whose notes
 * were all resolved or removed since keeps picks with nothing on them, and
 * starting it would open members onto an empty list: what "at least one
 * household" at creation exists to prevent.
 */
async function hasSomethingOwed(db: Database, session: LockedSession): Promise<boolean> {
  const found = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(onRevisitList(db, session))
    .limit(1);
  return found.length > 0;
}

/*
 * Under the session's row lock, which household changes and visit writes
 * also take, so what a start checks still holds when it lands.
 */
export function transitionSession(
  db: Database,
  id: string,
  transition: Transition,
): Promise<SessionRow> {
  const { from, to, done } = TRANSITIONS[transition];
  return db.transaction(async (tx) => {
    const current = await lockSession(tx, id);

    if (current.status !== from) {
      throw new ConflictError(
        "conflict",
        `This session ${STATE[current.status]}, so it cannot be ${done}.`,
      );
    }
    if (
      transition === "start" &&
      current.kind === "follow_up" &&
      !(await hasSomethingOwed(tx, current))
    ) {
      throw new ConflictError("conflict", NOTHING_OWED);
    }

    const now = new Date();
    const values =
      to === "active"
        ? { status: to, updatedAt: now, startedAt: current.startedAt ?? now, endedAt: null }
        : { status: to, updatedAt: now, endedAt: now };

    try {
      await tx.update(outingSessions).set(values).where(eq(outingSessions.id, id));
    } catch (error) {
      if (isActiveSessionClash(error)) {
        /*
         * Reopen hits this whenever another session is active. It is the
         * recovery path for a session ended by mistake, so the message has to
         * say what to do rather than surface a constraint name.
         */
        throw new ConflictError(
          "session_already_active",
          "Another session is already active. End it before starting or reopening this one.",
        );
      }
      throw error;
    }

    return getSession(tx, id);
  });
}

export type SessionBlockMember = { id: string; name: string | null; image: string | null };

export type SessionBlockRow = {
  blockId: string;
  blockName: string;
  blockStreet: string;
  blockPostalCode: string | null;
  blockCreatedAt: Date;
  visitCount: number;
  householdCount: number;
  activeMembers: SessionBlockMember[];
};

export async function listSessionBlocks(
  db: Database,
  sessionId: string,
): Promise<SessionBlockRow[]> {
  /*
   * Visits reach a block through households, so both joins are needed. Counts
   * come from one grouped query rather than a lookup per block, which would be
   * N+1 on the member landing screen.
   */
  const rows = await db
    .select({
      blockId: blocks.id,
      blockName: blocks.name,
      blockStreet: blocks.street,
      blockPostalCode: blocks.postalCode,
      blockCreatedAt: blocks.createdAt,
      visitCount: sql<number>`count(distinct ${visits.id})::int`,
      householdCount: sql<number>`count(distinct ${visits.householdId})::int`,
    })
    .from(sessionBlocks)
    .innerJoin(blocks, eq(blocks.id, sessionBlocks.blockId))
    .leftJoin(households, eq(households.blockId, blocks.id))
    .leftJoin(
      visits,
      and(eq(visits.householdId, households.id), eq(visits.sessionId, sessionBlocks.sessionId)),
    )
    .where(eq(sessionBlocks.sessionId, sessionId))
    .groupBy(blocks.id, blocks.name, blocks.street, blocks.postalCode, blocks.createdAt)
    .orderBy(blocks.name);

  const members = await listBlockMembers(db, sessionId);

  return rows.map((row) => ({
    ...row,
    activeMembers: members.get(row.blockId) ?? [],
  }));
}

/*
 * Who has recorded on each block during this session. Informational only -
 * blocks are shared and never locked to a member.
 */
async function listBlockMembers(
  db: Database,
  sessionId: string,
): Promise<Map<string, SessionBlockMember[]>> {
  const rows = await db
    .selectDistinct({
      blockId: households.blockId,
      id: users.id,
      name: users.name,
      image: users.image,
    })
    .from(visits)
    .innerJoin(households, eq(households.id, visits.householdId))
    .innerJoin(users, eq(users.id, visits.memberId))
    .where(eq(visits.sessionId, sessionId));

  const byBlock = new Map<string, SessionBlockMember[]>();
  for (const row of rows) {
    const existing = byBlock.get(row.blockId) ?? [];
    existing.push({ id: row.id, name: row.name, image: row.image });
    byBlock.set(row.blockId, existing);
  }
  return byBlock;
}

export async function findActiveSession(db: Database): Promise<SessionRow | undefined> {
  const rows = await db
    .select(sessionColumns)
    .from(outingSessions)
    .innerJoin(users, eq(users.id, outingSessions.createdBy))
    .where(eq(outingSessions.status, "active"))
    .limit(1);
  return rows[0];
}

/*
 * Detaching a block that already has visits recorded in this session is
 * refused. History is never orphaned by a UI action - an admin tidying up the
 * block list must not silently strip a member's afternoon of work off it.
 *
 * Under the session's row lock, which recording a visit also takes (FOR KEY
 * SHARE) before it checks the block is attached: a detach waits for a visit
 * in flight and sees it, or the visit waits and finds the block gone.
 */
export function detachBlock(db: Database, sessionId: string, blockId: string): Promise<void> {
  return db.transaction(async (tx) => {
    await lockSession(tx, sessionId);

    const attached = await tx
      .select({ blockId: sessionBlocks.blockId })
      .from(sessionBlocks)
      .where(and(eq(sessionBlocks.sessionId, sessionId), eq(sessionBlocks.blockId, blockId)))
      .limit(1);

    if (attached.length === 0) {
      throw new NotFoundError("That block is not attached to this session.");
    }

    if (await blockHasSessionVisits(tx, sessionId, blockId)) {
      throw new ConflictError(
        "block_in_use",
        "That block has visits recorded in this session, so it cannot be detached.",
      );
    }

    await tx
      .delete(sessionBlocks)
      .where(and(eq(sessionBlocks.sessionId, sessionId), eq(sessionBlocks.blockId, blockId)));
  });
}
