import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { buildAuthConfig } from "@/server/auth/config";

/*
 * The callbacks are thin wrappers over the pure functions in callbacks.ts, but
 * they are the wiring Auth.js actually calls - a mistake here would mean a
 * role never reaching the session, with every unit test still green.
 */

const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/nowhere",
    authSecret: "a-secret-that-is-long-enough-for-tests",
    auth: { trustHost: false, secureCookies: false },
    rateLimit: {
      signInAttempts: 10,
      signInAttemptsPerClient: 30,
      signInWindowSeconds: 300,
      trustedProxyHops: 0,
    },
  })),
}));
vi.mock("@/server/config", () => ({ getConfig }));

afterEach(async () => {
  await resetDatabase();
});

const config = () => buildAuthConfig();

describe("session strategy", () => {
  it("uses JWTs, forced by the Credentials provider in #15", () => {
    expect(config().session?.strategy).toBe("jwt");
  });

  it("expires sessions after 30 days", () => {
    expect(config().session?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("offers credentials sign-in", () => {
    // Google follows in #14.
    const ids = config().providers.map((provider) =>
      typeof provider === "function" ? "" : provider.id,
    );
    expect(ids).toContain("credentials");
  });

  it("routes sign-in and errors to our own page", () => {
    expect(config().pages?.signIn).toBe("/sign-in");
    expect(config().pages?.error).toBe("/sign-in");
  });
});

describe("settings from config", () => {
  it("signs with the configured secret", () => {
    expect(config().secret).toBe("a-secret-that-is-long-enough-for-tests");
  });

  it("honours auth.trustHost rather than always trusting the host header", () => {
    expect(config().trustHost).toBe(false);
  });

  it("takes the cookie flags from auth.secureCookies, not the request's scheme", () => {
    // The proxy builds from the same base, so both name the cookies alike.
    expect(config().useSecureCookies).toBe(false);
  });
});

describe("jwt callback", () => {
  it("puts the user's role on the token at sign-in", async () => {
    const jwt = config().callbacks?.jwt;
    const token = await jwt?.({
      token: {},
      user: { id: "u1", email: "a@b.c", role: "admin", deactivatedAt: null },
      account: null,
    });
    expect(token).toMatchObject({ sub: "u1", role: "admin", deactivated: false });
  });

  it("passes the token through on later requests", async () => {
    const jwt = config().callbacks?.jwt;
    const existing = { sub: "u1", role: "member" as const, deactivated: false };
    // Auth.js types the sign-in and pass-through calls as one union that does
    // not model the runtime shapes separately.
    const token = await jwt?.({ token: existing, account: null } as never);
    expect(token).toMatchObject(existing);
  });
});

describe("jwt callback on a session update", () => {
  it("renames the token without touching its role", async () => {
    const jwt = config().callbacks?.jwt;
    const existing = { sub: "u1", role: "member" as const, deactivated: false };
    const token = await jwt?.({
      token: existing,
      trigger: "update",
      session: { name: "New Name", role: "admin" },
    } as never);
    expect(token).toMatchObject({ name: "New Name", role: "member" });
  });
});

describe("session callback", () => {
  it("surfaces the token's role on the session the app reads", async () => {
    const sessionCallback = config().callbacks?.session;
    const result = await sessionCallback?.({
      session: {
        user: { id: "", email: "a@b.c", emailVerified: null },
        expires: "2026-12-01T00:00:00Z",
        via: "",
      } as never,
      token: { sub: "u1", role: "admin", deactivated: false },
    } as never);
    expect(result).toMatchObject({ user: { id: "u1", role: "admin", deactivated: false } });
  });
});
