import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { signIns, users, type Role } from "@/db/schema";
import { describeDevice } from "@/lib/session/device";
import { SESSION_MAX_AGE_SECONDS } from "@/server/auth/lifetime";
import { firstOrThrow } from "@/server/db-utils";
import { NotFoundError } from "@/server/http/errors";

/*
 * Sign-ins (#125). Each one is a row in sign_ins, named by its id in the
 * session JWT's signInId claim. A JWT on its own cannot be taken back, so
 * every request checks its row is still there; deleting the row is what ends
 * a sign-in, for sign-out, an admin, or a deactivation.
 *
 * Every time here is Postgres's now(), never the app server's clock, so
 * several app servers judge "last used" and "expired" alike.
 */

/* "Last used" is written at most this often, so a request seldom writes. */
export const TOUCH_EVERY_SECONDS = 15 * 60;

/*
 * A row unused for longer than the cookie lives is dead: no token naming it
 * can still be valid. Plus the touch interval, since a row in use can read up
 * to that much older than its last request.
 */
export const EXPIRES_AFTER_SECONDS = SESSION_MAX_AGE_SECONDS + TOUCH_EVERY_SECONDS;

/* Bounds the admin's unpaged list, and the table against a scripted loop of sign-ins. */
export const MAX_SIGN_INS = 50;

export const MAX_USER_AGENT_LENGTH = 512;

const seconds = (value: number) => sql.raw(`interval '${String(value)} seconds'`);
const touchDue = sql`now() - ${seconds(TOUCH_EVERY_SECONDS)}`;
const expiredBefore = sql`now() - ${seconds(EXPIRES_AFTER_SECONDS)}`;

/* A token's claim; anything but a UUID names no row, and must not reach a uuid column. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/*
 * Starts a sign-in and returns its id, or null when the account is
 * deactivated or gone.
 *
 * The first statement locks the user FOR SHARE, the lock POST /visits takes
 * on its author (D-132-4), and only while the account is active. A
 * deactivation waits for it, and so ends this sign-in with the rest; a
 * sign-in that waited for a deactivation finds the account deactivated.
 * Either way no sign-in outlives a deactivation, so reactivating brings none
 * back. Nothing here locks a user after a sign_ins row, which is
 * updateUser's order too, so the two cannot deadlock.
 */
export async function startSignIn(
  db: Database,
  userId: string,
  userAgent: string | null,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const active = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deactivatedAt)))
      .for("share");
    if (active.length === 0) return null;

    await tx
      .delete(signIns)
      .where(and(eq(signIns.userId, userId), lt(signIns.lastUsedAt, expiredBefore)));

    /* Room for the new one: past the cap, the least recently used go. */
    const beyond = await tx
      .select({ id: signIns.id })
      .from(signIns)
      .where(eq(signIns.userId, userId))
      .orderBy(desc(signIns.lastUsedAt), desc(signIns.createdAt))
      .offset(MAX_SIGN_INS - 1);
    if (beyond.length > 0) {
      await tx.delete(signIns).where(
        inArray(
          signIns.id,
          beyond.map((row) => row.id),
        ),
      );
    }

    const inserted = await tx
      .insert(signIns)
      .values({ userId, userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null })
      .returning({ id: signIns.id });
    return firstOrThrow(inserted, "the sign-in insert").id;
  });
}

export type Account = {
  email: string;
  name: string | null;
  role: Role;
  deactivatedAt: Date | null;
};

export type SignInCheck =
  | { status: "no-user" }
  | { status: "deactivated"; account: Account }
  | { status: "ended"; account: Account }
  | { status: "live"; account: Account; signInId: string };

/*
 * The per-request check: the account and the token's sign-in in one query.
 * A deactivated account is reported as such whatever its sign-in, so the
 * member is told they are deactivated rather than signed out (D-85-2).
 *
 * The only write is "last used", and only once it is a quarter of an hour
 * old: a conditional UPDATE, so two requests at once write it once.
 */
export async function checkSignIn(
  db: Database,
  userId: string,
  claim: unknown,
): Promise<SignInCheck> {
  const signInId = asUuid(claim);
  const rows = await db
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
      signInId: signIns.id,
      due: sql<boolean | null>`${signIns.lastUsedAt} < ${touchDue}`,
    })
    .from(users)
    .leftJoin(
      signIns,
      and(
        signInId === null ? sql`false` : eq(signIns.id, signInId),
        eq(signIns.userId, users.id),
        gte(signIns.lastUsedAt, expiredBefore),
      ),
    )
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return { status: "no-user" };
  const account: Account = {
    email: row.email,
    name: row.name,
    role: row.role,
    deactivatedAt: row.deactivatedAt,
  };
  if (row.deactivatedAt !== null) return { status: "deactivated", account };
  if (row.signInId === null) return { status: "ended", account };

  if (row.due === true) {
    await db
      .update(signIns)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(signIns.id, row.signInId), lt(signIns.lastUsedAt, touchDue)));
  }
  return { status: "live", account, signInId: row.signInId };
}

/* Sign-out: this sign-in only, and only if it is the user's. */
export async function endSignIn(db: Database, userId: string, claim: unknown): Promise<void> {
  const signInId = asUuid(claim);
  if (signInId === null) return;
  await db.delete(signIns).where(and(eq(signIns.id, signInId), eq(signIns.userId, userId)));
}

/*
 * An admin ending one of a member's sign-ins. One that has expired is
 * already over, though not yet pruned: it is left for that, and answered as
 * ended, as the list no longer shows it.
 */
export async function endOneSignIn(db: Database, userId: string, signInId: string): Promise<void> {
  const ended = await db
    .delete(signIns)
    .where(
      and(
        eq(signIns.id, signInId),
        eq(signIns.userId, userId),
        gte(signIns.lastUsedAt, expiredBefore),
      ),
    )
    .returning({ id: signIns.id });
  if (ended.length === 0) {
    throw new NotFoundError("That sign-in has already ended.");
  }
}

/* Every sign-in of the user's but `keep`, the caller's own when it is their account. */
export async function endAllSignIns(
  db: Database,
  userId: string,
  keep: string | null = null,
): Promise<void> {
  await db
    .delete(signIns)
    .where(and(eq(signIns.userId, userId), keep === null ? undefined : ne(signIns.id, keep)));
}

export type SignInView = {
  id: string;
  device: string;
  signedInAt: Date;
  lastUsedAt: Date;
  current: boolean;
};

/* The live ones, most recently used first; `current` is the caller's own. */
export async function listSignIns(
  db: Database,
  userId: string,
  current: string,
): Promise<SignInView[]> {
  const rows = await db
    .select({
      id: signIns.id,
      userAgent: signIns.userAgent,
      createdAt: signIns.createdAt,
      lastUsedAt: signIns.lastUsedAt,
    })
    .from(signIns)
    .where(and(eq(signIns.userId, userId), gte(signIns.lastUsedAt, expiredBefore)))
    .orderBy(desc(signIns.lastUsedAt), desc(signIns.createdAt))
    .limit(MAX_SIGN_INS);
  return rows.map((row) => ({
    id: row.id,
    device: describeDevice(row.userAgent),
    signedInAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    current: row.id === current,
  }));
}
