import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import type { Approval, Role } from "@/db/schema";
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
 * Deactivated users are excluded from listings by default and not deleted
 * when they leave: their records stay attributed to them, because history has
 * to survive someone leaving. So is everyone not approved (#249): the team,
 * its pickers and its counts are the approved accounts, and the queue is
 * asked for by name. Only erasure (#279) anonymises one, and the records
 * stay then too.
 */

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  approval: Approval;
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
      approval: users.approval,
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
    approval: Approval;
    includeDeactivated: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ rows: UserRow[]; total: number }> {
  const filter = and(
    // An erased account is anonymised in place and never listed again (D-279).
    isNull(users.erasedAt),
    eq(users.approval, options.approval),
    ...(options.role === undefined ? [] : [eq(users.role, options.role)]),
    ...(options.includeDeactivated ? [] : [isNull(users.deactivatedAt)]),
  );

  const rows = await selectUsers(db)
    .orderBy(
      /* The team by name so a picker reads alphabetically; email breaks the
         tie and is never null, so the order is stable across pages. A queue
         oldest first, so whoever has waited longest is at the top; the id
         breaks a tie (#212). */
      ...(options.approval === "approved"
        ? [asc(users.name), asc(users.email)]
        : [asc(users.createdAt), asc(users.id)]),
    )
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
  const rows = await selectUsers(db)
    .where(and(eq(users.id, id), isNull(users.erasedAt)))
    .limit(1);
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
      throw new ConflictError("conflict", await takenMessage(db, email));
    }
    throw error;
  }
}

/*
 * Someone who asked with Google is never added over the top: approval always
 * makes a member, and an add could otherwise give them a role or a password
 * (#249). The admin is pointed at the action that applies instead.
 */
async function takenMessage(db: Database, email: string): Promise<string> {
  const found = await db
    .select({ approval: users.approval })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  switch (found[0]?.approval) {
    case "pending":
      return `${email} is waiting for approval. Approve them under Waiting for approval.`;
    case "blocked":
      return `${email} wasn't approved. Unblock them under Not approved first.`;
    default:
      return "That email address already belongs to someone.";
  }
}

/*
 * What an admin's change to an account is judged on: the target and every
 * active admin in one statement, FOR NO KEY UPDATE in id order. Shared with
 * erasing an account, which is a deactivation and holds the same rules. An
 * erased account is gone: it answers as no such user.
 */
export type LockedAccount = {
  id: string;
  role: Role;
  approval: Approval;
  deactivatedAt: Date | null;
  erasedAt: Date | null;
};

export async function lockAccountChange(
  tx: Database,
  id: string,
): Promise<{ locked: LockedAccount[]; current: LockedAccount }> {
  const locked = await tx
    .select({
      id: users.id,
      role: users.role,
      approval: users.approval,
      deactivatedAt: users.deactivatedAt,
      erasedAt: users.erasedAt,
    })
    .from(users)
    .where(or(eq(users.id, id), and(eq(users.role, "admin"), isNull(users.deactivatedAt))))
    .orderBy(asc(users.id))
    .for("no key update");

  /* The path's id may be in capitals (R-161). Each comparison below takes
     either case, or a capitalised id would skip the self rules, and count
     the target itself as another admin. */
  const current = locked.find((row) => sameUuid(row.id, id));
  if (current?.erasedAt !== null) {
    throw new NotFoundError("No such user.");
  }
  return { locked, current };
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
    const { locked, current } = await lockAccountChange(tx, id);
    /* A role or deactivation would skip the queue; the check constraint
       would refuse either, but with a constraint name for a message. */
    if (current.approval !== "approved") {
      throw new ConflictError(
        "conflict",
        "They haven't been approved. Approve, reject or unblock them instead.",
      );
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
  /* Guarded in the UPDATE itself: an erasure that commits while it waits on
     the row lock must not get the name back (Postgres re-checks only the
     filter, so the check has to be in it). */
  const renamed = await db
    .update(users)
    .set({ name: checked.name, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.erasedAt)))
    .returning({ id: users.id });
  if (renamed.length === 0) {
    throw new NotFoundError("Your account no longer exists.");
  }
  return getUser(db, userId);
}

/*
 * Approving, rejecting and unblocking (#249). Each is one conditional UPDATE
 * from the state it applies to, so two admins at once cannot both move the
 * same person: the second finds the row moved on and is told why. Nobody's
 * sign-ins are touched. They are checked against the row on every request,
 * so the change reaches the person's next one; a rejected person keeps
 * theirs, which authorize nothing but reading their own state, so that an
 * unblock reaches a phone still signed in.
 */
async function moveApproval(
  db: Database,
  id: string,
  from: Approval,
  to: Approval,
  refusal: (current: Approval) => string,
  extra: { reopenedAt?: Date } = {},
): Promise<UserRow> {
  const moved = await db
    .update(users)
    .set({ approval: to, updatedAt: new Date(), ...extra })
    .where(and(eq(users.id, id), eq(users.approval, from), isNull(users.erasedAt)))
    .returning({ id: users.id });
  if (moved.length === 0) {
    const found = await db
      .select({ approval: users.approval })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.erasedAt)))
      .limit(1);
    const current = found[0];
    if (!current) {
      throw new NotFoundError("No such user.");
    }
    throw new ConflictError("conflict", refusal(current.approval));
  }
  return getUser(db, id);
}

/* Always as a member: the check constraint holds everyone waiting to that. */
export function approveUser(db: Database, id: string): Promise<UserRow> {
  return moveApproval(db, id, "pending", "approved", (current) =>
    current === "blocked"
      ? "Their request was rejected. Unblock them first."
      : "They've already been approved.",
  );
}

export function rejectUser(db: Database, id: string): Promise<UserRow> {
  return moveApproval(db, id, "pending", "blocked", (current) =>
    current === "blocked"
      ? "Their request was already rejected."
      : "They've already been approved. Deactivate them instead.",
  );
}

export function unblockUser(db: Database, id: string): Promise<UserRow> {
  return moveApproval(db, id, "blocked", "pending", () => "They aren't blocked.", {
    reopenedAt: new Date(),
  });
}

/*
 * A first Google sign-in (#249): an account waiting for approval, a member
 * with no password and no picture, named by Google when the name is one a
 * member could have given themselves. Returns null when the address was
 * taken meanwhile, by a second sign-in racing this one or an admin adding it.
 */
export type AccessRequest = {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  role: Role;
  deactivatedAt: Date | null;
};

export async function createAccessRequest(
  db: Database,
  input: { email: string; name: string | null },
): Promise<AccessRequest | null> {
  try {
    const inserted = await db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: null,
        image: null,
        role: "member",
        approval: "pending",
      })
      .returning({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        name: users.name,
        image: users.image,
        role: users.role,
        deactivatedAt: users.deactivatedAt,
      });
    return firstOrThrow(inserted, "the access request insert");
  } catch (error) {
    if (isConstraintViolation(error, "users_email_unique")) {
      return null;
    }
    throw error;
  }
}
