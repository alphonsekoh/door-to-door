import type * as PasswordModule from "@/server/password";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { untouchableDatabase } from "@/db/testing";
import { zCreateUserRequest } from "@/generated/zod.gen";
import {
  MAX_EMAIL_LENGTH,
  SIGN_IN_FAILED_MESSAGE,
  authorizeCredentials,
  authorizeFromRawCredentials,
} from "@/server/auth/credentials";
import { createRateLimiter, type RateLimiter } from "@/server/auth/rate-limit";
import type { SignInLog } from "@/server/auth/sign-in-log";
import { MAX_PASSWORD_LENGTH } from "@/server/password";

/*
 * The over-long path (#120), which must refuse before it costs anything: no
 * budget, no query, no argon2. The rest of sign-in needs a database and is in
 * credentials.integration.test.ts.
 */

const { verifyPassword } = vi.hoisted(() => ({ verifyPassword: vi.fn() }));
vi.mock("@/server/password", async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  verifyPassword,
}));
vi.mock("@/server/config", () => ({
  getConfig: () => {
    throw new Error("the config was read");
  },
}));

const DOMAIN = "@example.org";
const emailOf = (length: number) => `${"a".repeat(length - DOMAIN.length)}${DOMAIN}`;
const PASSWORD = "password123";

function spyLimiter(): RateLimiter {
  const real = createRateLimiter({ limit: 100, windowMs: 60_000 });
  return { ...real, consume: vi.fn(real.consume) };
}

function spyLog(): SignInLog {
  return { failed: vi.fn(), oversized: vi.fn(), limited: vi.fn(), unattributed: vi.fn() };
}

function harness() {
  const limiters = {
    limiter: spyLimiter(),
    clientLimiter: spyLimiter(),
    globalLimiter: spyLimiter(),
  };
  const log = spyLog();
  return {
    limiters,
    log,
    deps: { db: untouchableDatabase(), ...limiters, clientKey: "198.51.100.7", log },
    consumed: () =>
      Object.values(limiters).some((limiter) => vi.mocked(limiter.consume).mock.calls.length > 0),
  };
}

beforeEach(() => {
  verifyPassword.mockReset();
});

describe("over-long credentials", () => {
  it.each([
    ["an email one past the cap", emailOf(MAX_EMAIL_LENGTH + 1), PASSWORD],
    ["an email one past the cap once trimmed", ` ${emailOf(MAX_EMAIL_LENGTH + 1)} `, PASSWORD],
    ["a password one past the cap", emailOf(20), "p".repeat(MAX_PASSWORD_LENGTH + 1)],
    ["a megabyte of email", emailOf(1_000_000), PASSWORD],
  ])("refuses %s before any budget, query or argon2", async (_case, email, password) => {
    const { deps, log, consumed } = harness();
    expect(await authorizeFromRawCredentials({ email, password }, undefined, deps)).toBeNull();
    expect(consumed()).toBe(false);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(log.oversized).toHaveBeenCalledTimes(1);
  });

  it("refuses with the same message as any other failure", async () => {
    // D-15-1: nothing tells an over-long attempt from a wrong password.
    const { deps } = harness();
    await expect(
      authorizeCredentials({ email: emailOf(MAX_EMAIL_LENGTH + 1), password: PASSWORD }, deps),
    ).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
  });

  it.each([
    ["an email exactly at the cap", emailOf(MAX_EMAIL_LENGTH), PASSWORD],
    ["whitespace that trims down to the cap", `   ${emailOf(MAX_EMAIL_LENGTH)}\t`, PASSWORD],
    ["a password exactly at the cap", emailOf(20), "p".repeat(MAX_PASSWORD_LENGTH)],
  ])("lets %s through to the budgets and the database", async (_case, email, password) => {
    const { deps, limiters, log } = harness();
    await expect(authorizeCredentials({ email, password }, deps)).rejects.toThrow(
      "the database was used",
    );
    expect(limiters.limiter.consume).toHaveBeenCalledTimes(1);
    expect(log.oversized).not.toHaveBeenCalled();
  });

  it("uses the caps POST /users enforces, so no account can hold a longer value", () => {
    expect(MAX_EMAIL_LENGTH).toBe(zCreateUserRequest.shape.email.maxLength);
    expect(MAX_PASSWORD_LENGTH).toBe(zCreateUserRequest.shape.password.maxLength);
  });
});
