import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import {
  RATE_LIMITED_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  SignInError,
  authorizeCredentials,
  authorizeFromRawCredentials,
  normaliseEmail,
  resetDefaultLimiter,
} from "@/server/auth/credentials";
import { createRateLimiter } from "@/server/auth/rate-limit";
import { hashPassword } from "@/server/password";

const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({
    databaseUrl: process.env["TEST_DATABASE_URL"],
    rateLimit: { signInAttempts: 2, signInWindowSeconds: 60 },
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

describe("the limiter built from config", () => {
  it("allows exactly rateLimit.signInAttempts attempts, then refuses", async () => {
    await seedUser({ email: "member@test.local" });
    const attempt = () =>
      authorizeCredentials({ email: "member@test.local", password: "wrong-password" }, { db });

    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
    await expect(attempt()).rejects.toThrow(RATE_LIMITED_MESSAGE);
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
