import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { users } from "@/db/schema";
import { zCreateUserRequest } from "@/generated/zod.gen";
import { checkOwnName } from "@/lib/session/own-name";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { MAX_PASSWORD_LENGTH, assertPasswordAcceptable, hashPassword } from "@/server/password";

/*
 * Bootstraps the first admin of a fresh database (#105). There is no sign-up,
 * so without this somebody has to write an argon2 hash into the users table by
 * hand. It only ever creates the first one: once any admin exists, further
 * admins are added in the app, where the change is made by a signed-in admin.
 */

export class CreateAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateAdminError";
  }
}

export const ADMIN_EXISTS_MESSAGE =
  "An admin already exists, so nothing was changed. Further admins are added in the app, on Admin > Team.";

/* The same rules POST /users applies to an email and an initial password. */
export function checkAdminEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!zCreateUserRequest.shape.email.safeParse(email).success) {
    throw new CreateAdminError(`"${raw}" is not a valid email address.`);
  }
  return email;
}

export function checkAdminPassword(password: string): void {
  assertPasswordAcceptable(password);
  if (!zCreateUserRequest.shape.password.safeParse(password).success) {
    throw new CreateAdminError(
      `Password must be at most ${String(MAX_PASSWORD_LENGTH)} characters.`,
    );
  }
}

/* The rule a user's own rename goes through, since this is their own name. */
export function checkAdminName(raw: string): string {
  const checked = checkOwnName(raw);
  if (!checked.ok) {
    throw new CreateAdminError(checked.message);
  }
  return checked.name;
}

/* Deactivated admins count: the script must never become a way to add one. */
export async function adminExists(db: Pick<Database, "select">): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  return rows.length > 0;
}

/* Exported so a test can hold the same lock and prove the check waits on it. */
export const CREATE_ADMIN_LOCK = "door-to-door:create-admin";

export type FirstAdminInput = { email: string; name: string | null; password: string };
export type CreatedAdmin = { id: string; email: string };

export async function createFirstAdmin(
  db: Database,
  input: FirstAdminInput,
): Promise<CreatedAdmin> {
  const email = checkAdminEmail(input.email);
  const name = input.name === null ? null : checkAdminName(input.name);
  checkAdminPassword(input.password);
  /* Hashed outside the transaction so the lock is not held through ~50ms of argon2. */
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx) => {
      /*
       * Two runs at once would both see no admin and both insert. No
       * constraint can say "at most one admin until the first exists", so the
       * check and the insert are serialised on a transaction-scoped advisory
       * lock instead; it is released by the commit or rollback.
       */
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${CREATE_ADMIN_LOCK}))`);
      if (await adminExists(tx)) {
        throw new CreateAdminError(ADMIN_EXISTS_MESSAGE);
      }
      const inserted = await tx
        .insert(users)
        .values({ email, name, passwordHash, role: "admin" })
        .returning({ id: users.id, email: users.email });
      return firstOrThrow(inserted, "the admin insert");
    });
  } catch (error) {
    if (isConstraintViolation(error, "users_email_unique")) {
      throw new CreateAdminError(`${email} already belongs to an account, so nothing was changed.`);
    }
    throw error;
  }
}
