import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role } from "@/db/schema";
import { signIns, users, visits } from "@/db/schema";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { checkOwnName } from "@/lib/session/own-name";
import { sameUuid } from "@/lib/uuid";
import {
  GOOGLE_NOT_SET_UP_MESSAGE,
  inGoogleDomains,
  outsideGoogleDomainsMessage,
} from "@/lib/session/google-domains";
import { ConflictError, NotFoundError, ValidationError } from "@/server/http/errors";
import { hashPassword } from "@/server/password";

/*
 * The team.
 *
 * Deactivated users are excluded from listings by default but never deleted:
 * their records stay attributed to them, because history has to survive
 * someone leaving.
 */

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  deactivatedAt: Date | null;
  lastRecordedAt: Date | null;
  createdAt: Date;
};

/*
 * Last activity comes from a grouped subquery joined on, not a correlated
 * scalar. Drizzle renders a column interpolated into raw SQL unqualified, so
 * `where v.member_id = ${users.id}` became `= "id"` and silently resolved
 * against the subquery's own table - every row came back null with no error.
 *
 * Left joined, so somebody who has never recorded keeps a null rather than
 * dropping out of the list. An account nobody uses is the thing worth seeing.
 */
function activity(db: Database) {
  return db
    .select({
      memberId: visits.memberId,
      lastRecordedAt: sql`max(${visits.createdAt})`
        .mapWith(visits.createdAt)
        .as("last_recorded_at"),
    })
    .from(visits)
    .groupBy(visits.memberId)
    .as("activity");
}

function selectUsers(db: Database) {
  const recent = activity(db);
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
      lastRecordedAt: recent.lastRecordedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(recent, eq(recent.memberId, users.id));
}

export async function listUsers(
  db: Database,
  options: {
    role?: Role | undefined;
    includeDeactivated: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ rows: UserRow[]; total: number }> {
  const conditions = [
    ...(options.role === undefined ? [] : [eq(users.role, options.role)]),
    ...(options.includeDeactivated ? [] : [isNull(users.deactivatedAt)]),
  ];
  const filter = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await selectUsers(db)
    /* By name so a picker reads alphabetically; email breaks the tie and is
       never null, so the order is stable across pages. */
    .orderBy(asc(users.name), asc(users.email))
    .where(filter)
    .limit(options.limit)
    .offset(options.offset);

  const counted = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(filter);

  return { rows, total: firstOrThrow(counted, "the user count").total };
}

/*
 * The message is a parameter because /users/me looks the caller up by their
 * own token: "no such user" reads there as though they had asked for someone
 * else, when what happened is that their account is gone.
 */
export async function getUser(
  db: Database,
  id: string,
  notFound = "No such user.",
): Promise<UserRow> {
  const rows = await selectUsers(db).where(eq(users.id, id)).limit(1);
  const found = rows[0];
  if (!found) {
    throw new NotFoundError(notFound);
  }
  return found;
}

/*
 * With no password the account signs in with Google only (#14). That is
 * refused while Google sign-in is not set up, and for an address outside
 * `googleDomains`, where Google refuses to sign anyone in: nobody could sign
 * in as it.
 */
export async function createUser(
  db: Database,
  input: {
    email: string;
    name?: string | null | undefined;
    password?: string | undefined;
    role?: Role;
  },
  googleDomains: readonly string[] | null,
): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();
  if (input.password === undefined) {
    if (googleDomains === null) {
      throw new ConflictError("conflict", GOOGLE_NOT_SET_UP_MESSAGE);
    }
    if (!inGoogleDomains(email, googleDomains)) {
      throw new ConflictError("conflict", outsideGoogleDomainsMessage(googleDomains));
    }
  }
  /* Hashed before the insert so a weak password is refused without leaving a
     half-made account behind. */
  const passwordHash = input.password === undefined ? null : await hashPassword(input.password);

  try {
    const inserted = await db
      .insert(users)
      .values({
        email,
        name: input.name ?? null,
        passwordHash,
        role: input.role ?? "member",
      })
      .returning({ id: users.id });

    return await getUser(db, firstOrThrow(inserted, "the user insert").id);
  } catch (error) {
    if (isConstraintViolation(error, "users_email_unique")) {
      throw new ConflictError("conflict", "That email address already belongs to someone.");
    }
    throw error;
  }
}

/*
 * An admin may not demote or deactivate themselves, and nobody may demote or
 * deactivate the last active admin. With one admin on the team - the normal
 * case - either move locks every admin out of the app with no way back in
 * short of the host.
 *
 * The last-admin rule is judged on rows one statement locks: the target and
 * every active admin, FOR NO KEY UPDATE in id order. Two admins demoting each
 * other at once queue on the same rows, so the second reads the first's
 * change, and two changes never lock in opposite orders. NO KEY UPDATE never
 * blocks the KEY SHARE a foreign key takes on a user.
 *
 * Deactivating also ends every one of the user's sign-ins, after those locks
 * and in the same transaction (#125). A sign-in being started holds the user
 * FOR SHARE, so it either lands first and is ended here, or waits and finds
 * the account deactivated; reactivating then brings none back.
 */
export async function updateUser(
  db: Database,
  id: string,
  changes: { role?: Role | undefined; deactivated?: boolean | undefined },
  actorId: string,
): Promise<UserRow> {
  await db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: users.id, role: users.role, deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(or(eq(users.id, id), and(eq(users.role, "admin"), isNull(users.deactivatedAt))))
      .orderBy(asc(users.id))
      .for("no key update");

    /* The path's id may be in capitals (R-161). Each comparison below takes
       either case, or a capitalised id would skip the self rules, and count
       the target itself as another admin. */
    const current = locked.find((row) => sameUuid(row.id, id));
    if (!current) {
      throw new NotFoundError("No such user.");
    }

    if (sameUuid(id, actorId)) {
      if (changes.role !== undefined && changes.role !== current.role) {
        throw new ConflictError("conflict", "You cannot change your own role.");
      }
      if (changes.deactivated === true) {
        throw new ConflictError("conflict", "You cannot deactivate your own account.");
      }
    }

    const wasActiveAdmin = current.role === "admin" && current.deactivatedAt === null;
    const staysActiveAdmin =
      (changes.role ?? current.role) === "admin" &&
      !(changes.deactivated ?? current.deactivatedAt !== null);
    /* Postgres re-checks the filter on a row it waited for, so every other
       locked row is still an active admin once the change ahead has landed. */
    const anotherAdmin = locked.some((row) => !sameUuid(row.id, id));
    if (wasActiveAdmin && !staysActiveAdmin && !anotherAdmin) {
      throw new ConflictError("conflict", "The team needs at least one active admin.");
    }

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (changes.role !== undefined) values["role"] = changes.role;
    if (changes.deactivated !== undefined) {
      values["deactivatedAt"] = changes.deactivated ? new Date() : null;
    }

    await tx.update(users).set(values).where(eq(users.id, id));
    if (changes.deactivated === true) {
      await tx.delete(signIns).where(eq(signIns.userId, id));
    }
  });
  return getUser(db, id);
}

/*
 * Acts on the caller only - the id is the session's, never a parameter - so
 * there is no way to name somebody else here. A name is a label: visits point
 * at the user by id, so renaming rewrites no record and no author.
 */
export async function updateOwnName(db: Database, userId: string, raw: string): Promise<UserRow> {
  const checked = checkOwnName(raw);
  if (!checked.ok) {
    throw new ValidationError(checked.message);
  }
  await getUser(db, userId, "Your account no longer exists.");
  await db
    .update(users)
    .set({ name: checked.name, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return getUser(db, userId);
}
