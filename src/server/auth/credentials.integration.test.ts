import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import type { AppConfig } from "@/lib/config";
import {
  MAX_EMAIL_LENGTH,
  RATE_LIMITED_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  SignInError,
  authorizeCredentials,
  authorizeFromRawCredentials,
  normaliseEmail,
  resetDefaultLimiter,
  type AuthorizeDeps,
} from "@/server/auth/credentials";
import { createRateLimiter, type RateLimiter } from "@/server/auth/rate-limit";
import { createSignInLog, digestKey, type SignInLog } from "@/server/auth/sign-in-log";
import { MAX_PASSWORD_LENGTH, hashPassword } from "@/server/password";

/* Reset before each test; a test changes a key before the first sign-in builds the limiters. */
const settings = vi.hoisted(() => {
  const base = (): AppConfig["rateLimit"] => ({
    signInAttempts: 2,
    signInAttemptsPerClient: 50,
    signInWindowSeconds: 60,
    trustedProxyHops: 0,
  });
  return { base, rateLimit: base() };
});
const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({
    databaseUrl: process.env["TEST_DATABASE_URL"],
    rateLimit: settings.rateLimit,
  })),
}));
vi.mock("@/server/config", () => ({ getConfig }));

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const PASSWORD = "password123";

async function seedUser(options: {
  email: string;
  role?: "admin" | "member";
  password?: string | null;
  deactivated?: boolean;
}): Promise<void> {
  const hash = options.password === null ? null : await hashPassword(options.password ?? PASSWORD);
  await pool.query(
    `INSERT INTO users (email, name, role, password_hash, deactivated_at)
     VALUES ($1, 'Test User', $2, $3, $4)`,
    [
      options.email,
      options.role ?? "member",
      hash,
      options.deactivated === true ? new Date() : null,
    ],
  );
}

const freshLimiter = () => createRateLimiter({ limit: 50, windowMs: 60_000 });

beforeEach(async () => {
  await truncateAll(pool);
  settings.rateLimit = settings.base();
  resetDefaultLimiter();
});

afterAll(async () => {
  await pool.end();
});

describe("successful sign-in", () => {
  it("authorises an admin", async () => {
    await seedUser({ email: "admin@test.local", role: "admin" });
    const user = await authorizeCredentials(
      { email: "admin@test.local", password: PASSWORD },
      { db, limiter: freshLimiter() },
    );
    expect(user).toMatchObject({ email: "admin@test.local", role: "admin" });
  });

  it("authorises a member", async () => {
    await seedUser({ email: "member@test.local" });
    const user = await authorizeCredentials(
      { email: "member@test.local", password: PASSWORD },
      { db, limiter: freshLimiter() },
    );
    expect(user.role).toBe("member");
  });

  it("never returns the password hash", async () => {
    // The acceptance criterion: hashes must not reach any response.
    await seedUser({ email: "member@test.local" });
    const user = await authorizeCredentials(
      { email: "member@test.local", password: PASSWORD },
      { db, limiter: freshLimiter() },
    );
    expect(JSON.stringify(user)).not.toMatch(/argon2/);
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("authorises the longest email and password an account can have", async () => {
    // The over-long refusal (#120) starts one character past these.
    const email = `${"a".repeat(MAX_EMAIL_LENGTH - "@test.local".length)}@test.local`;
    const password = "p".repeat(MAX_PASSWORD_LENGTH);
    await seedUser({ email, password });
    const user = await authorizeFromRawCredentials({ email, password }, undefined, {
      db,
      limiter: freshLimiter(),
    });
    expect(user).toMatchObject({ email });
  });

  it("accepts a differently-cased email", async () => {
    await seedUser({ email: "member@test.local" });
    const user = await authorizeCredentials(
      { email: "  Member@Test.Local  ", password: PASSWORD },
      { db, limiter: freshLimiter() },
    );
    expect(user.email).toBe("member@test.local");
  });
});

describe("failed sign-in", () => {
  it.each([
    ["an unknown email", { email: "nobody@test.local", password: PASSWORD }],
    ["a wrong password", { email: "member@test.local", password: "wrong-password" }],
  ])("rejects %s with the same message", async (_case, credentials) => {
    await seedUser({ email: "member@test.local" });
    await expect(
      authorizeCredentials(credentials, { db, limiter: freshLimiter() }),
    ).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
  });

  it("rejects a deactivated account, without saying so", async () => {
    // Saying "deactivated" would confirm the account exists.
    await seedUser({ email: "gone@test.local", deactivated: true });
    await expect(
      authorizeCredentials(
        { email: "gone@test.local", password: PASSWORD },
        { db, limiter: freshLimiter() },
      ),
    ).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
  });

  it("rejects an SSO-only account that has no password", async () => {
    await seedUser({ email: "google@test.local", password: null });
    await expect(
      authorizeCredentials(
        { email: "google@test.local", password: PASSWORD },
        { db, limiter: freshLimiter() },
      ),
    ).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
  });
});

describe("timing", () => {
  it("takes comparable time for an unknown email and a wrong password", async () => {
    /*
     * The enumeration oracle this guards against: verifyPassword returns
     * immediately for a null hash, so without the decoy an unknown email
     * answers in microseconds while a real one costs a full argon2 verify.
     *
     * Medians over several samples rather than single readings, so the result
     * is not decided by one scheduling hiccup on a loaded runner.
     */
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 1000, windowMs: 60_000 });

    const timeOnce = async (email: string): Promise<number> => {
      const started = performance.now();
      await authorizeCredentials({ email, password: "wrong-password" }, { db, limiter }).catch(
        () => undefined,
      );
      return performance.now() - started;
    };

    const median = async (email: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        samples.push(await timeOnce(email));
      }
      samples.sort((a, b) => a - b);
      return samples[2] ?? 0;
    };

    // Warm the decoy so its one-off cost is not attributed to a sample.
    await timeOnce("warmup@test.local");

    const unknown = await median("nobody@test.local");
    const wrongPassword = await median("member@test.local");

    /*
     * Both paths run one argon2 verify, so the ratio sits near 1. Removing the
     * decoy pushes it into the hundreds, which is the failure this catches;
     * 3x leaves ample room for ordinary jitter.
     */
    const ratio = Math.max(unknown, wrongPassword) / Math.min(unknown, wrongPassword);
    expect(
      ratio,
      `unknown=${unknown.toFixed(1)}ms wrong=${wrongPassword.toFixed(1)}ms`,
    ).toBeLessThan(3);
  });

  it("takes comparable time for a correct and a wrong password", async () => {
    // Clearing the count on success (#86) must not make a success stand out.
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 1000, windowMs: 60_000 });

    const median = async (password: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        await authorizeCredentials({ email: "member@test.local", password }, { db, limiter }).catch(
          () => undefined,
        );
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      return samples[2] ?? 0;
    };

    await median(PASSWORD);
    const correct = await median(PASSWORD);
    const wrong = await median("wrong-password");

    const ratio = Math.max(correct, wrong) / Math.min(correct, wrong);
    expect(ratio, `correct=${correct.toFixed(1)}ms wrong=${wrong.toFixed(1)}ms`).toBeLessThan(3);
  });
});

describe("rate limiting", () => {
  it("blocks further attempts once the limit is reached", async () => {
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const attempt = () =>
      authorizeCredentials(
        { email: "member@test.local", password: "wrong-password" },
        { db, limiter },
      );

    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("blocks the correct password too, once the budget is spent", async () => {
    // Otherwise an attacker learns the password by whether the answer changes.
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    await authorizeCredentials(
      { email: "member@test.local", password: "wrong" },
      { db, limiter },
    ).catch(() => undefined);

    await expect(
      authorizeCredentials({ email: "member@test.local", password: PASSWORD }, { db, limiter }),
    ).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("budgets per email, so one account cannot lock out another", async () => {
    await seedUser({ email: "alice@test.local" });
    await seedUser({ email: "ben@test.local" });
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    await authorizeCredentials(
      { email: "alice@test.local", password: "wrong" },
      { db, limiter },
    ).catch(() => undefined);

    await expect(
      authorizeCredentials({ email: "ben@test.local", password: PASSWORD }, { db, limiter }),
    ).resolves.toMatchObject({ email: "ben@test.local" });
  });
});

describe("only failed attempts count (#86)", () => {
  /*
   * Through authorizeFromRawCredentials, the function Auth.js calls (D-15-4).
   * Every refusal there is null, so whether the counter was cleared is read
   * from whether a later correct password still gets in.
   */
  const signIn = (limiter: RateLimiter, email: string, password: string) =>
    authorizeFromRawCredentials({ email, password }, undefined, { db, limiter });
  const fail = (limiter: RateLimiter, email = "member@test.local") =>
    signIn(limiter, email, "wrong-password");
  const succeed = (limiter: RateLimiter, email = "member@test.local") =>
    signIn(limiter, email, PASSWORD);

  it("lets an account sign in again and again without locking it out", async () => {
    // The reported bug: repeated legitimate sign-ins spent the budget.
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    for (let i = 0; i < 5; i += 1) {
      expect(await succeed(limiter)).toMatchObject({ email: "member@test.local" });
    }
  });

  it("clears earlier failures when a correct password arrives before the limit", async () => {
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

    expect(await fail(limiter)).toBeNull();
    expect(await fail(limiter)).toBeNull();
    expect(await succeed(limiter)).toMatchObject({ email: "member@test.local" });

    // Without the clear the window would already hold three attempts.
    expect(await fail(limiter)).toBeNull();
    expect(await fail(limiter)).toBeNull();
    expect(await succeed(limiter)).toMatchObject({ email: "member@test.local" });
  });

  it("still refuses the correct password once the failures spend the budget", async () => {
    // D-15-3: the (N+1)th attempt is refused whatever the password.
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });

    expect(await fail(limiter)).toBeNull();
    expect(await fail(limiter)).toBeNull();
    expect(await succeed(limiter)).toBeNull();
  });

  it("does not let a refused correct password clear a spent budget", async () => {
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    await fail(limiter);
    await fail(limiter);

    expect(await succeed(limiter)).toBeNull();
    expect(await succeed(limiter)).toBeNull();
    await expect(
      authorizeCredentials({ email: "member@test.local", password: PASSWORD }, { db, limiter }),
    ).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("does not clear the count for a deactivated account's correct password", async () => {
    // A refusal is a refusal, even when the password matched.
    await seedUser({ email: "gone@test.local", deactivated: true });
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });

    expect(await fail(limiter, "gone@test.local")).toBeNull();
    expect(await succeed(limiter, "gone@test.local")).toBeNull();
    await expect(
      authorizeCredentials({ email: "gone@test.local", password: PASSWORD }, { db, limiter }),
    ).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("clears only the account that signed in", async () => {
    await seedUser({ email: "alice@test.local" });
    await seedUser({ email: "ben@test.local" });
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    await fail(limiter, "ben@test.local");
    expect(await succeed(limiter, "alice@test.local")).toMatchObject({
      email: "alice@test.local",
    });
    expect(await succeed(limiter, "ben@test.local")).toBeNull();
  });

  it("counts concurrent failures, so a burst cannot outrun the limit", async () => {
    /*
     * The guesses are all in flight before any of them finishes verifying, so
     * a limiter that only recorded a failure after verifying would let every
     * one of them through - including the right one at the end of the burst.
     */
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const guesses = [...Array.from({ length: 7 }, (_, i) => `wrong-${String(i)}`), PASSWORD];

    const outcomes = await Promise.allSettled(
      guesses.map((password) =>
        authorizeCredentials({ email: "member@test.local", password }, { db, limiter }),
      ),
    );
    const messages = outcomes.map((outcome) =>
      outcome.status === "rejected" && outcome.reason instanceof Error
        ? outcome.reason.message
        : "signed in",
    );

    expect(messages).toEqual([
      ...Array.from({ length: 3 }, () => SIGN_IN_FAILED_MESSAGE),
      ...Array.from({ length: 5 }, () => RATE_LIMITED_MESSAGE),
    ]);
    expect(await succeed(limiter)).toBeNull();
  });
});

describe("the limiter built from config", () => {
  it("allows exactly rateLimit.signInAttempts attempts, then refuses", async () => {
    await seedUser({ email: "member@test.local" });
    const attempt = () =>
      authorizeCredentials({ email: "member@test.local", password: "wrong-password" }, { db });

    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("clears its count on a successful sign-in", async () => {
    // rateLimit.signInAttempts is 2 here, so without the clear the third is refused.
    await seedUser({ email: "member@test.local" });
    const attempt = (password: string) =>
      authorizeCredentials({ email: "member@test.local", password }, { db });

    await expect(attempt("wrong-password")).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt(PASSWORD)).resolves.toMatchObject({ email: "member@test.local" });
    await expect(attempt("wrong-password")).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt("wrong-password")).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt(PASSWORD)).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("reads the config once and reuses the limiter", async () => {
    getConfig.mockClear();
    await seedUser({ email: "member@test.local" });
    for (let i = 0; i < 2; i += 1) {
      await authorizeCredentials({ email: "member@test.local", password: PASSWORD }, { db });
    }
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Member@Test.Local ")).toBe("member@test.local");
  });
});

describe("SignInError", () => {
  it("defaults to the generic message", () => {
    expect(new SignInError().message).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(new SignInError().name).toBe("SignInError");
  });
});

describe("authorizeFromRawCredentials", () => {
  /*
   * The function Auth.js is configured with. Tested directly rather than
   * through the built provider: Auth.js replaces authorize with its own
   * wrapper, so calling provider.authorize exercises Auth.js, not this code -
   * it returns null synchronously regardless of the credentials.
   */
  const deps = () => ({ db, limiter: freshLimiter() });

  it("returns the user for valid credentials", async () => {
    await seedUser({ email: "member@test.local" });
    const user = await authorizeFromRawCredentials(
      { email: "member@test.local", password: PASSWORD },
      undefined,
      deps(),
    );
    expect(user).toMatchObject({ email: "member@test.local", role: "member" });
  });

  it("returns null rather than throwing for a wrong password", async () => {
    await seedUser({ email: "member@test.local" });
    expect(
      await authorizeFromRawCredentials(
        { email: "member@test.local", password: "wrong" },
        undefined,
        deps(),
      ),
    ).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    expect(
      await authorizeFromRawCredentials(
        { email: "nobody@test.local", password: PASSWORD },
        undefined,
        deps(),
      ),
    ).toBeNull();
  });

  it("returns null when rate limited, rather than surfacing why", async () => {
    await seedUser({ email: "member@test.local" });
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    await authorizeFromRawCredentials(
      { email: "member@test.local", password: "wrong" },
      undefined,
      { db, limiter },
    );
    expect(
      await authorizeFromRawCredentials(
        { email: "member@test.local", password: PASSWORD },
        undefined,
        { db, limiter },
      ),
    ).toBeNull();
  });

  it.each([
    ["a missing email", { password: PASSWORD }],
    ["a missing password", { email: "member@test.local" }],
    ["a non-string email", { email: 42, password: PASSWORD }],
    ["an empty object", {}],
  ])("returns null for %s", async (_case, raw) => {
    expect(await authorizeFromRawCredentials(raw, undefined, deps())).toBeNull();
  });

  it("falls back to the shared database when none is supplied", async () => {
    // The path Auth.js actually takes, with no deps argument.
    await seedUser({ email: "member@test.local" });
    const user = await authorizeFromRawCredentials({
      email: "member@test.local",
      password: PASSWORD,
    });
    expect(user).toMatchObject({ email: "member@test.local" });
  });
});

const CLIENT_X = "198.51.100.7";
const CLIENT_Y = "203.0.113.9";

/* A Request as Auth.js hands it to authorize, for authorizeFromRawCredentials. */
const requestFrom = (forwardedFor?: string) =>
  new Request("http://localhost/api/auth/callback/credentials", {
    method: "POST",
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });

type Outcome = "signed in" | "failed" | "limited";

/* Which of the three ways an attempt ended, read from authorizeCredentials directly. */
async function outcomeOf(
  credentials: { email: string; password: string },
  deps: AuthorizeDeps,
): Promise<Outcome> {
  try {
    await authorizeCredentials(credentials, deps);
    return "signed in";
  } catch (error) {
    if (error instanceof SignInError) {
      return error.message === RATE_LIMITED_MESSAGE ? "limited" : "failed";
    }
    throw error;
  }
}

describe("the per-client budget (#120)", () => {
  it("refuses a client that has spent it, even with another account's correct password", async () => {
    // Password spraying: one or two guesses at every account, which the
    // per-account budget never sees.
    await seedUser({ email: "alice@test.local" });
    await seedUser({ email: "ben@test.local" });
    const clientLimiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const from = (clientKey: string, email: string, password: string) =>
      outcomeOf({ email, password }, { db, limiter: freshLimiter(), clientLimiter, clientKey });

    expect(await from(CLIENT_X, "alice@test.local", "wrong-password")).toBe("failed");
    expect(await from(CLIENT_X, "nobody@test.local", "wrong-password")).toBe("failed");
    expect(await from(CLIENT_X, "ben@test.local", PASSWORD)).toBe("limited");
    expect(await from(CLIENT_Y, "ben@test.local", PASSWORD)).toBe("signed in");
  });

  it("gives the client its attempt back when the account budget refuses", async () => {
    await seedUser({ email: "alice@test.local" });
    const clientLimiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const deps = {
      db,
      limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
      clientLimiter,
      clientKey: CLIENT_X,
    };
    const attempt = (email: string) => outcomeOf({ email, password: "wrong-password" }, deps);

    expect(await attempt("alice@test.local")).toBe("failed");
    for (let i = 0; i < 3; i += 1) {
      expect(await attempt("alice@test.local")).toBe("limited");
    }
    // Only the first attempt is still charged to the client, so two more fit.
    expect(await attempt("ben@test.local")).toBe("failed");
    expect(await attempt("carol@test.local")).toBe("failed");
    expect(await attempt("dan@test.local")).toBe("limited");
  });

  it("gives back only the success's own attempt, leaving the client's failures counted", async () => {
    // A member signing in from a sprayer's address must not wipe its count.
    await seedUser({ email: "alice@test.local" });
    const clientLimiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const from = (email: string, password: string) =>
      outcomeOf(
        { email, password },
        { db, limiter: freshLimiter(), clientLimiter, clientKey: CLIENT_X },
      );

    expect(await from("nobody-1@test.local", "wrong-password")).toBe("failed");
    expect(await from("nobody-2@test.local", "wrong-password")).toBe("failed");
    expect(await from("alice@test.local", PASSWORD)).toBe("signed in");
    expect(await from("nobody-3@test.local", "wrong-password")).toBe("failed");
    expect(await from("nobody-4@test.local", "wrong-password")).toBe("limited");
  });

  it("gives nothing back for a deactivated account's correct password", async () => {
    await seedUser({ email: "gone@test.local", deactivated: true });
    const clientLimiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const attempt = () =>
      outcomeOf(
        { email: "gone@test.local", password: PASSWORD },
        { db, limiter: freshLimiter(), clientLimiter, clientKey: CLIENT_X },
      );

    expect(await attempt()).toBe("failed");
    expect(await attempt()).toBe("failed");
    expect(await attempt()).toBe("limited");
  });

  it("caps a concurrent burst of distinct emails from one client at its limit", async () => {
    await seedUser({ email: "alice@test.local" });
    const deps = {
      db,
      limiter: freshLimiter(),
      clientLimiter: createRateLimiter({ limit: 3, windowMs: 60_000 }),
      clientKey: CLIENT_X,
    };
    const guesses = [
      ...Array.from({ length: 7 }, (_, i) => ({
        email: `user-${String(i)}@test.local`,
        password: "wrong-password",
      })),
      { email: "alice@test.local", password: PASSWORD },
    ];

    const outcomes = await Promise.all(guesses.map((guess) => outcomeOf(guess, deps)));
    expect(outcomes).toEqual([
      ...Array.from({ length: 3 }, () => "failed"),
      ...Array.from({ length: 5 }, () => "limited"),
    ]);
  });

  it("is built from config with rateLimit.signInAttemptsPerClient", async () => {
    settings.rateLimit.signInAttemptsPerClient = 2;
    await seedUser({ email: "alice@test.local" });
    const from = (clientKey: string, email: string, password: string) =>
      outcomeOf({ email, password }, { db, clientKey });

    expect(await from(CLIENT_X, "nobody-1@test.local", "wrong-password")).toBe("failed");
    expect(await from(CLIENT_X, "nobody-2@test.local", "wrong-password")).toBe("failed");
    expect(await from(CLIENT_X, "alice@test.local", PASSWORD)).toBe("limited");
    expect(await from(CLIENT_Y, "alice@test.local", PASSWORD)).toBe("signed in");
  });
});

describe("the client, from X-Forwarded-For (#120)", () => {
  function signInWith(clientLimiter: RateLimiter, log?: SignInLog) {
    return (request: Request | undefined, email: string, password: string) =>
      authorizeFromRawCredentials({ email, password }, request, {
        db,
        limiter: freshLimiter(),
        clientLimiter,
        ...(log === undefined ? {} : { log }),
      });
  }

  it("keys on the rightmost entry when one proxy is trusted, whatever the client wrote before it", async () => {
    settings.rateLimit.trustedProxyHops = 1;
    await seedUser({ email: "alice@test.local" });
    const signIn = signInWith(createRateLimiter({ limit: 2, windowMs: 60_000 }));

    expect(await signIn(requestFrom(`10.0.0.1, ${CLIENT_X}`), "a@test.local", "wrong")).toBeNull();
    expect(await signIn(requestFrom(`10.0.0.2, ${CLIENT_X}`), "b@test.local", "wrong")).toBeNull();
    // Refused although the password is right: the forged entry changed nothing.
    expect(
      await signIn(requestFrom(`10.0.0.3, ${CLIENT_X}`), "alice@test.local", PASSWORD),
    ).toBeNull();
    expect(
      await signIn(requestFrom(`10.0.0.1, ${CLIENT_Y}`), "alice@test.local", PASSWORD),
    ).toMatchObject({ email: "alice@test.local" });
  });

  it("ignores the header entirely when no proxy is trusted", async () => {
    await seedUser({ email: "alice@test.local" });
    const clientLimiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const signIn = signInWith(clientLimiter);

    expect(await signIn(requestFrom(CLIENT_X), "a@test.local", "wrong")).toBeNull();
    expect(await signIn(requestFrom(CLIENT_X), "b@test.local", "wrong")).toBeNull();
    expect(await signIn(requestFrom(CLIENT_X), "alice@test.local", PASSWORD)).toMatchObject({
      email: "alice@test.local",
    });
    expect(clientLimiter.size()).toBe(0);
  });

  it("puts an attempt with no usable entry in one shared bucket, and says so", async () => {
    settings.rateLimit.trustedProxyHops = 2;
    await seedUser({ email: "alice@test.local" });
    const lines: string[] = [];
    const log = createSignInLog({ log: (line) => lines.push(line) });
    const signIn = signInWith(createRateLimiter({ limit: 2, windowMs: 60_000 }), log);

    expect(await signIn(requestFrom(CLIENT_X), "a@test.local", "wrong")).toBeNull();
    expect(await signIn(undefined, "b@test.local", "wrong")).toBeNull();
    expect(await signIn(requestFrom(), "alice@test.local", PASSWORD)).toBeNull();
    expect(lines.filter((line) => line.includes("X-Forwarded-For"))).toHaveLength(1);
  });
});

describe("the app-wide budget, an incident switch (#120)", () => {
  it("is off unless rateLimit.signInAttemptsGlobal is set", async () => {
    await seedUser({ email: "alice@test.local" });
    for (let i = 0; i < 5; i += 1) {
      expect(
        await outcomeOf({ email: `nobody-${String(i)}@test.local`, password: "wrong" }, { db }),
      ).toBe("failed");
    }
    expect(await outcomeOf({ email: "alice@test.local", password: PASSWORD }, { db })).toBe(
      "signed in",
    );
  });

  it("once spent, refuses every account, the correct password included", async () => {
    settings.rateLimit.signInAttemptsGlobal = 2;
    await seedUser({ email: "alice@test.local" });
    const attempt = (email: string, password: string) => outcomeOf({ email, password }, { db });

    expect(await attempt("nobody-1@test.local", "wrong")).toBe("failed");
    expect(await attempt("nobody-2@test.local", "wrong")).toBe("failed");
    expect(await attempt("alice@test.local", PASSWORD)).toBe("limited");
  });

  it("is charged first, then the client, then the account", async () => {
    await seedUser({ email: "alice@test.local" });
    const order: string[] = [];
    const recorded = (name: string, limit: number): RateLimiter => {
      const real = createRateLimiter({ limit, windowMs: 60_000 });
      return {
        ...real,
        consume: (key) => {
          order.push(name);
          return real.consume(key);
        },
      };
    };
    const deps = {
      db,
      globalLimiter: recorded("global", 1),
      clientLimiter: recorded("client", 10),
      limiter: recorded("account", 10),
      clientKey: CLIENT_X,
    };

    expect(await outcomeOf({ email: "alice@test.local", password: "wrong" }, deps)).toBe("failed");
    expect(order).toEqual(["global", "client", "account"]);

    // A spent app-wide budget refuses before the others are charged at all.
    order.length = 0;
    expect(await outcomeOf({ email: "alice@test.local", password: PASSWORD }, deps)).toBe(
      "limited",
    );
    expect(order).toEqual(["global"]);
  });

  it("gets its attempt back when the client budget refuses", async () => {
    await seedUser({ email: "alice@test.local" });
    const globalLimiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const clientLimiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const from = (clientKey: string, email: string, password: string) =>
      outcomeOf(
        { email, password },
        { db, limiter: freshLimiter(), globalLimiter, clientLimiter, clientKey },
      );

    expect(await from(CLIENT_X, "nobody-1@test.local", "wrong")).toBe("failed");
    expect(await from(CLIENT_X, "nobody-2@test.local", "wrong")).toBe("limited");
    expect(await from(CLIENT_Y, "nobody-3@test.local", "wrong")).toBe("failed");
    expect(await from("192.0.2.1", "alice@test.local", PASSWORD)).toBe("limited");
  });

  it("gets back only the success's own attempt", async () => {
    await seedUser({ email: "alice@test.local" });
    const globalLimiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const attempt = (email: string, password: string) =>
      outcomeOf({ email, password }, { db, limiter: freshLimiter(), globalLimiter });

    expect(await attempt("nobody-1@test.local", "wrong")).toBe("failed");
    expect(await attempt("nobody-2@test.local", "wrong")).toBe("failed");
    expect(await attempt("alice@test.local", PASSWORD)).toBe("signed in");
    expect(await attempt("nobody-3@test.local", "wrong")).toBe("failed");
    expect(await attempt("nobody-4@test.local", "wrong")).toBe("limited");
  });
});

describe("logging (#120)", () => {
  it("writes one line for a failure, carrying a tag and never the email", async () => {
    await seedUser({ email: "member@test.local" });
    const lines: string[] = [];
    const log = createSignInLog({ log: (line) => lines.push(line) });

    await authorizeFromRawCredentials(
      { email: "Member@Test.Local", password: "wrong-password" },
      undefined,
      { db, limiter: freshLimiter(), log },
    );

    expect(lines).toEqual([
      `Sign-in failed: wrong email or password (account ${digestKey("account", "member@test.local").slice(0, 12)})`,
    ]);
    expect(lines.join("\n")).not.toMatch(/member@test\.local/i);
  });

  it("names the budget that refused, without the email", async () => {
    const lines: string[] = [];
    const log = createSignInLog({ log: (line) => lines.push(line), quietMs: 0 });
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const attempt = () =>
      outcomeOf({ email: "member@test.local", password: "wrong" }, { db, limiter, log });

    expect(await attempt()).toBe("failed");
    expect(await attempt()).toBe("limited");
    expect(lines[1]).toMatch(
      /^Sign-in refused: the account attempt budget is spent \(account [0-9a-f]{12}\)$/,
    );
    expect(lines.join("\n")).not.toContain("member@test.local");
  });

  it("keys and tags the client budget by digest, never by the address", async () => {
    // D-120-4: the limiter's memory holds no address either.
    settings.rateLimit.trustedProxyHops = 1;
    await seedUser({ email: "alice@test.local" });
    const lines: string[] = [];
    const log = createSignInLog({ log: (line) => lines.push(line), quietMs: 0 });
    const keys: string[] = [];
    const real = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const clientLimiter: RateLimiter = {
      ...real,
      consume: (key) => {
        keys.push(key);
        return real.consume(key);
      },
      refund: (key) => {
        keys.push(key);
        real.refund(key);
      },
    };
    const signIn = (email: string, password: string) =>
      authorizeFromRawCredentials({ email, password }, requestFrom(CLIENT_X), {
        db,
        limiter: freshLimiter(),
        clientLimiter,
        log,
      });

    expect(await signIn("alice@test.local", PASSWORD)).toMatchObject({ email: "alice@test.local" });
    expect(await signIn("nobody@test.local", "wrong")).toBeNull();
    expect(await signIn("alice@test.local", PASSWORD)).toBeNull();

    const digest = digestKey("client", CLIENT_X);
    // Charged, refunded on the success, charged, then refused.
    expect(keys).toEqual([digest, digest, digest, digest]);
    expect(lines.at(-1)).toBe(
      `Sign-in refused: the client attempt budget is spent (client ${digest.slice(0, 12)})`,
    );
  });

  it("never writes an email or an address, whichever line it writes", async () => {
    // Both are 12 characters, the length of a tag, so one passed as a tag would be written whole.
    const email = "a@test.local";
    settings.rateLimit.trustedProxyHops = 1;
    const lines: string[] = [];
    const deps = {
      db,
      limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
      clientLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
      log: createSignInLog({ log: (line) => lines.push(line), quietMs: 0 }),
    };
    const from = (forwardedFor: string | undefined, tried: string, password = "wrong-password") =>
      authorizeFromRawCredentials({ email: tried, password }, requestFrom(forwardedFor), deps);

    await from(CLIENT_X, email, "p".repeat(MAX_PASSWORD_LENGTH + 1));
    await from(CLIENT_X, email);
    await from(CLIENT_X, email);
    await from(CLIENT_X, "b@test.local");
    await from(CLIENT_X, "c@test.local");
    await from(undefined, "d@test.local");

    expect(lines).toEqual([
      expect.stringMatching(/^Sign-in refused: an email or password longer /),
      expect.stringMatching(/^Sign-in failed: wrong email or password \(account /),
      expect.stringMatching(/^Sign-in refused: the account attempt budget is spent \(account /),
      expect.stringMatching(/^Sign-in failed: /),
      expect.stringMatching(/^Sign-in refused: the client attempt budget is spent \(client /),
      expect.stringMatching(/^Sign-in from no usable X-Forwarded-For entry: /),
      expect.stringMatching(/^Sign-in failed: /),
    ]);
    const written = lines.join("\n");
    expect(written).not.toContain(email);
    expect(written).not.toContain(CLIENT_X);
  });
});
