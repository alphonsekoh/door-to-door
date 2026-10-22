import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Role } from "@/db/schema";
import { users, visits } from "@/db/schema";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { checkOwnName } from "@/lib/session/own-name";
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

export async function createUser(
  db: Database,
  input: { email: string; name?: string | null | undefined; password: string; role?: Role },
): Promise<UserRow> {
  /* Hashed before the insert so a weak password is refused without leaving a
     half-made account behind. */
  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim().toLowerCase();

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
 * An admin may not demote or deactivate themselves.
 *
 * With one admin on the team - the normal case - either move locks every
 * admin out of the app with no way back in short of editing the database.
 */
export async function updateUser(
  db: Database,
  id: string,
  changes: { role?: Role | undefined; deactivated?: boolean | undefined },
  actorId: string,
): Promise<UserRow> {
  const current = await getUser(db, id);

  if (id === actorId) {
    if (changes.role !== undefined && changes.role !== current.role) {
      throw new ConflictError("conflict", "You cannot change your own role.");
    }
    if (changes.deactivated === true) {
      throw new ConflictError("conflict", "You cannot deactivate your own account.");
    }
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.role !== undefined) values["role"] = changes.role;
  if (changes.deactivated !== undefined) {
    values["deactivatedAt"] = changes.deactivated ? new Date() : null;
  }

  await db.update(users).set(values).where(eq(users.id, id));
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
