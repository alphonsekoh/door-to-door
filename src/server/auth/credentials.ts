import { eq, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import { users, type Role } from "@/db/schema";
import { MAX_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/server/password";
import { UNATTRIBUTED, clientAddress } from "@/server/auth/client-address";
import { createRateLimiter, type RateLimiter } from "@/server/auth/rate-limit";
import {
  createSignInLog,
  digestKey,
  type SignInBudget,
  type SignInLog,
} from "@/server/auth/sign-in-log";
import { getConfig } from "@/server/config";

/*
 * Credentials sign-in.
 *
 * Every failure - unknown email, wrong password, deactivated account - returns
 * the same null result and the same message. Distinguishing them would turn
 * the sign-in form into a directory of who has an account.
 */

export const SIGN_IN_FAILED_MESSAGE = "Email or password is incorrect.";
export const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Try again shortly.";

/* Matches CreateUserRequest.email.maxLength in the contract. */
export const MAX_EMAIL_LENGTH = 320;

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
  clientLimiter?: RateLimiter;
  globalLimiter?: RateLimiter;
  attemptKey?: string;
  /* Undefined leaves the per-client budget out, as it is with no trusted proxy. */
  clientKey?: string | undefined;
  log?: SignInLog;
};

type DefaultLimiters = {
  account: RateLimiter;
  client: RateLimiter;
  global: RateLimiter | undefined;
};

/*
 * Built on first use from rateLimit in config.yaml, not at import: reading the
 * file at module scope would make `next build` need it (D-13-4).
 */
let defaultLimiters: DefaultLimiters | undefined;

function getDefaultLimiters(): DefaultLimiters {
  if (defaultLimiters === undefined) {
    const { signInAttempts, signInAttemptsPerClient, signInAttemptsGlobal, signInWindowSeconds } =
      getConfig().rateLimit;
    const windowMs = signInWindowSeconds * 1000;
    defaultLimiters = {
      account: createRateLimiter({ limit: signInAttempts, windowMs }),
      client: createRateLimiter({ limit: signInAttemptsPerClient, windowMs }),
      global:
        signInAttemptsGlobal === undefined
          ? undefined
          : createRateLimiter({ limit: signInAttemptsGlobal, windowMs }),
    };
  }
  return defaultLimiters;
}

export function resetDefaultLimiter(): void {
  defaultLimiters = undefined;
}

const defaultLog = createSignInLog();

/* The app-wide budget has one key; there is nothing to tell apart. */
const GLOBAL_KEY = "global";

type Charge = { budget: SignInBudget; limiter: RateLimiter; key: string };

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
  deps: AuthorizeDeps,
): Promise<AuthorizedUser> {
  const { db, attemptKey, clientKey, log = defaultLog } = deps;
  const email = normaliseEmail(credentials.email);

  /*
   * No account can hold a longer email or password (the POST /users caps), so
   * this refuses nobody who could sign in. It depends on the input alone, so
   * answering fast reveals nothing about accounts, and it keeps an attacker's
   * megabyte of email out of the limiter and argon2 (#120).
   */
  if (email.length > MAX_EMAIL_LENGTH || credentials.password.length > MAX_PASSWORD_LENGTH) {
    log.oversized();
    throw new SignInError();
  }

  const accountKey = attemptKey ?? digestKey("account", email);
  const account = deps.limiter ?? getDefaultLimiters().account;
  const globalLimiter = deps.globalLimiter ?? getDefaultLimiters().global;

  /* The budgets other accounts share, in the order they are charged. */
  const shared: Charge[] = [];
  if (globalLimiter !== undefined) {
    shared.push({ budget: "global", limiter: globalLimiter, key: GLOBAL_KEY });
  }
  if (clientKey !== undefined) {
    shared.push({
      budget: "client",
      limiter: deps.clientLimiter ?? getDefaultLimiters().client,
      key: digestKey("client", clientKey),
    });
  }
  const charges: Charge[] = [...shared, { budget: "account", limiter: account, key: accountKey }];

  /*
   * Every attempt is charged up front and a success clears the charge
   * afterwards, so only failures are left counting (#86). Charging only after
   * a failure would let a burst of concurrent guesses all pass the check
   * before any of them was counted. A spent budget refuses before the
   * password is looked at, so the correct one is refused too and never
   * clears it (D-15-3). The first budget to refuse gives back what this
   * attempt already took from the others, so one spent budget does not drain
   * the rest.
   */
  for (const [index, charge] of charges.entries()) {
    if (!charge.limiter.consume(charge.key).allowed) {
      for (const taken of charges.slice(0, index)) {
        taken.limiter.refund(taken.key);
      }
      log.limited(charge.budget, charge.budget === "global" ? undefined : charge.key);
      throw new SignInError(RATE_LIMITED_MESSAGE);
    }
  }

  const found = await findUserForSignIn(db, email);

  /*
   * Deliberately verify even when there is no user, and even when the account
   * is deactivated, so all three failures cost the same work.
   */
  const hash = found?.passwordHash ?? (await getDecoyHash());
  const passwordMatches = await verifyPassword(hash, credentials.password);

  if (!found || !passwordMatches || found.deactivatedAt !== null) {
    log.failed(accountKey);
    throw new SignInError();
  }

  /*
   * The account's own count is cleared (D-86-1), but a budget other accounts
   * share only gets this attempt back: a member signing in must not wipe a
   * sprayer's count off the client or app-wide budget.
   */
  account.reset(accountKey);
  for (const charge of shared) {
    charge.limiter.refund(charge.key);
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
 * The per-client key, when a trusted proxy is configured to vouch for one
 * (rateLimit.trustedProxyHops). Auth.js hands authorize a rebuilt Request that
 * keeps the original headers.
 */
function clientOf(request: Request | undefined, log: SignInLog): string | undefined {
  const hops = getConfig().rateLimit.trustedProxyHops;
  if (hops === 0) {
    return undefined;
  }
  const address = clientAddress(request?.headers.get("x-forwarded-for") ?? null, hops);
  if (address === UNATTRIBUTED) {
    log.unattributed();
  }
  return address;
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
  request?: Request,
  deps?: Partial<AuthorizeDeps>,
): Promise<AuthorizedUser | null> {
  const { email, password } = raw;
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }
  const log = deps?.log ?? defaultLog;
  try {
    return await authorizeCredentials(
      { email, password },
      {
        ...deps,
        db: deps?.db ?? getDatabase(),
        log,
        clientKey: deps?.clientKey ?? clientOf(request, log),
      },
    );
  } catch (error) {
    // A refusal was logged where it was decided.
    if (!(error instanceof SignInError)) {
      log.unexpected(error);
    }
    return null;
  }
}
