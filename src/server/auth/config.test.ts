import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { buildAuthConfig } from "@/server/auth/config";

/*
 * The callbacks are thin wrappers over the pure functions in callbacks.ts, but
 * they are the wiring Auth.js actually calls - a mistake here would mean a
 * role never reaching the session, with every unit test still green.
 */

const DB_URL = "postgresql://postgres:postgres@localhost:5432/nowhere";

afterEach(async () => {
  await resetDatabase();
  vi.unstubAllEnvs();
});

const config = () => {
  vi.stubEnv("DATABASE_URL", DB_URL);
  return buildAuthConfig();
};

describe("session strategy", () => {
  it("uses JWTs, forced by the Credentials provider in #15", () => {
    expect(config().session?.strategy).toBe("jwt");
  });

  it("expires sessions after 30 days", () => {
    expect(config().session?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("starts with no providers - Google is #14, credentials #15", () => {
    expect(config().providers).toEqual([]);
  });

  it("routes sign-in and errors to our own page", () => {
    expect(config().pages?.signIn).toBe("/sign-in");
    expect(config().pages?.error).toBe("/sign-in");
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
