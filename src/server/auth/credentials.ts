import { eq, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import { users, type Role } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/server/password";
import {
  SIGN_IN_ATTEMPT_LIMIT,
  SIGN_IN_WINDOW_MS,
  createRateLimiter,
  type RateLimiter,
} from "@/server/auth/rate-limit";

/*
 * Credentials sign-in.
 *
 * Every failure - unknown email, wrong password, deactivated account - returns
 * the same null result and the same message. Distinguishing them would turn
 * the sign-in form into a directory of who has an account.
 */

export const SIGN_IN_FAILED_MESSAGE = "Email or password is incorrect.";
export const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Try again shortly.";

export type SignInCredentials = { email: string; password: string };

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  deactivatedAt: Date | null;
};

export class SignInError extends Error {
  constructor(message: string = SIGN_IN_FAILED_MESSAGE) {
    super(message);
    this.name = "SignInError";
  }
}

/*
 * A real argon2 hash of a value nobody knows, verified against when no user is
 * found. Without it an unknown email returns in microseconds while a real one
 * costs ~50ms of hashing - a timing oracle that reveals which emails exist.
 * Computed once and reused.
 */
let decoyHash: string | undefined;

export async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword(`decoy-${crypto.randomUUID()}`);
  return decoyHash;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AuthorizeDeps = {
  db: Database;
  limiter?: RateLimiter;
  attemptKey?: string;
};

const defaultLimiter = createRateLimiter({
  limit: SIGN_IN_ATTEMPT_LIMIT,
  windowMs: SIGN_IN_WINDOW_MS,
});

export async function findUserForSignIn(
  db: Database,
  email: string,
): Promise<(AuthorizedUser & { passwordHash: string | null }) | undefined> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    // Stored emails are already normalised; compared lower-case so a typed
    // capital does not turn into "no such account".
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  return rows[0];
}

export async function authorizeCredentials(
  credentials: SignInCredentials,
  { db, limiter = defaultLimiter, attemptKey }: AuthorizeDeps,
): Promise<AuthorizedUser> {
  const email = normaliseEmail(credentials.email);
  const key = attemptKey ?? email;

  if (!limiter.consume(key).allowed) {
    throw new SignInError(RATE_LIMITED_MESSAGE);
  }

  const found = await findUserForSignIn(db, email);

  /*
   * Deliberately verify even when there is no user, and even when the account
   * is deactivated, so all three failures cost the same work.
   */
  const hash = found?.passwordHash ?? (await getDecoyHash());
  const passwordMatches = await verifyPassword(hash, credentials.password);

  if (!found || !passwordMatches || found.deactivatedAt !== null) {
    throw new SignInError();
  }

  return {
    id: found.id,
    email: found.email,
    name: found.name,
    role: found.role,
    deactivatedAt: found.deactivatedAt,
  };
}

/*
 * The provider's entry point, extracted so it can be tested directly. Reaching
 * for it through the configured provider does not work: Auth.js replaces the
 * authorize function with its own wrapper, so a test doing that exercises
 * Auth.js rather than this code.
 *
 * Returns null for every failure. Auth.js turns that into its generic
 * CredentialsSignin error, which is what the sign-in page shows.
 */
export async function authorizeFromRawCredentials(
  raw: Partial<Record<string, unknown>>,
  /* Auth.js passes the Request second; unused, but it fixes the signature. */
  _request?: unknown,
  deps?: Partial<AuthorizeDeps>,
): Promise<AuthorizedUser | null> {
  const { email, password } = raw;
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }
  try {
    return await authorizeCredentials(
      { email, password },
      { db: deps?.db ?? getDatabase(), ...deps },
    );
  } catch {
    return null;
  }
}
