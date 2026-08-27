import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { blocks, households, outingSessions, sessionBlocks, users, visits } from "@/db/schema";
import type { SessionStatus } from "@/db/schema";
import { firstOrThrow } from "@/server/db-utils";
import { ConflictError, NotFoundError } from "@/server/http/errors";

/*
 * Session lifecycle.
 *
 * Only one session may be active app-wide, enforced by a partial unique index.
 * Every transition therefore has to treat that constraint as a real outcome
 * rather than an assertion: two admins pressing Start at the same moment is a
 * race the application layer alone cannot close.
 */

export const ACTIVE_SESSION_CONSTRAINT = "one_active_session_idx";

/*
 * Postgres reports the partial unique index by name, but Drizzle wraps the
 * driver error, so the constraint lands on a cause further down the chain.
 * Anything else rethrows.
 */
export function isActiveSessionClash(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { constraint?: string }).constraint === ACTIVE_SESSION_CONSTRAINT) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type SessionRow = {
  id: string;
  title: string;
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
  options: { limit: number; offset: number; status?: SessionStatus },
): Promise<{ rows: SessionRow[]; total: number }> {
  const filter = options.status ? eq(outingSessions.status, options.status) : undefined;

  const rows = await db
    .select(sessionColumns)
    .from(outingSessions)
    .innerJoin(users, eq(users.id, outingSessions.createdBy))
    .where(filter)
    .orderBy(desc(outingSessions.createdAt))
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

export async function createSession(
  db: Database,
  input: { title: string; blockIds?: string[]; createdBy: string },
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(outingSessions)
      .values({ title: input.title, status: "draft", createdBy: input.createdBy })
      .returning({ id: outingSessions.id });

    const id = firstOrThrow(inserted, "the session insert").id;

    if (input.blockIds && input.blockIds.length > 0) {
      await attachBlocks(tx, id, input.blockIds);
    }
    return getSession(tx, id);
  });
}

/* Rejects unknown blocks before attaching any, so the request is all or nothing. */
export async function attachBlocks(
  db: Database,
  sessionId: string,
  blockIds: string[],
): Promise<void> {
  const unique = [...new Set(blockIds)];
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

const TRANSITIONS: Record<Transition, { from: SessionStatus; to: SessionStatus }> = {
  start: { from: "draft", to: "active" },
  end: { from: "active", to: "ended" },
  reopen: { from: "ended", to: "active" },
};

export async function transitionSession(
  db: Database,
  id: string,
  transition: Transition,
): Promise<SessionRow> {
  const { from, to } = TRANSITIONS[transition];
  const current = await getSession(db, id);

  if (current.status !== from) {
    throw new ConflictError(
      "conflict",
      `A ${current.status} session cannot be ${transition === "end" ? "ended" : `${transition}ed`}.`,
    );
  }

  const now = new Date();
  const values =
    to === "active"
      ? { status: to, updatedAt: now, startedAt: current.startedAt ?? now, endedAt: null }
      : { status: to, updatedAt: now, endedAt: now };

  try {
    await db.update(outingSessions).set(values).where(eq(outingSessions.id, id));
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

  return getSession(db, id);
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
