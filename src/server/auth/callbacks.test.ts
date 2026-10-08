import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE,
  applyTokenToSession,
  applyUpdateToToken,
  applyUserToToken,
} from "@/server/auth/callbacks";

describe("applyUserToToken", () => {
  it("copies id, role and deactivation onto the token at sign-in", () => {
    const token = applyUserToToken({}, { id: "u1", role: "admin", deactivatedAt: null });
    expect(token).toEqual({ sub: "u1", role: "admin", deactivated: false });
  });

  it("defaults a user with no role to member, never admin", () => {
    // An SSO sign-up must not be able to grant itself privileges.
    expect(applyUserToToken({}, { id: "u1" }).role).toBe(DEFAULT_ROLE);
    expect(applyUserToToken({}, { id: "u1" }).role).toBe("member");
  });

  it("marks a deactivated account on the token", () => {
    const token = applyUserToToken({}, { id: "u1", deactivatedAt: new Date() });
    expect(token.deactivated).toBe(true);
  });

  it("treats a string timestamp as deactivated too", () => {
    const token = applyUserToToken({}, { id: "u1", deactivatedAt: "2026-08-01T00:00:00Z" });
    expect(token.deactivated).toBe(true);
  });

  it("passes the token through untouched when there is no user", () => {
    // Every request after sign-in takes this path.
    const existing = { sub: "u1", role: "admin" as const, deactivated: false };
    expect(applyUserToToken(existing)).toEqual(existing);
  });

  it("keeps unrelated claims", () => {
    const token = applyUserToToken({ iat: 123 }, { id: "u1", role: "member" });
    expect(token["iat"]).toBe(123);
  });

  it("leaves sub alone when the user carries no id", () => {
    const token = applyUserToToken({ sub: "existing" }, { role: "admin" });
    expect(token.sub).toBe("existing");
  });
});

describe("applyTokenToSession", () => {
  /* Mirrors the real session shape, including fields Auth.js supplies. */
  type TestSession = {
    expires?: string;
    user?: {
      id?: string;
      role?: "admin" | "member";
      deactivated?: boolean;
      name?: string;
      email?: string;
    };
  };

  it("surfaces id, role and deactivation on the session", () => {
    const session = applyTokenToSession<TestSession>(
      { user: { name: "Alice" } },
      { sub: "u1", role: "admin", deactivated: false },
    );
    expect(session.user).toEqual({
      name: "Alice",
      id: "u1",
      role: "admin",
      deactivated: false,
    });
  });

  it("defaults a token with no role to member", () => {
    const session = applyTokenToSession<TestSession>({ user: {} }, { sub: "u1" });
    expect(session.user?.role).toBe("member");
  });

  it("defaults deactivation to false when the claim is absent", () => {
    const session = applyTokenToSession<TestSession>({ user: {} }, { sub: "u1", role: "member" });
    expect(session.user?.deactivated).toBe(false);
  });

  it("returns the session unchanged when it carries no user", () => {
    // Auth.js can call this before a user is attached.
    const session: TestSession = { expires: "2026-01-01" };
    expect(applyTokenToSession(session, { sub: "u1" })).toEqual(session);
  });

  it("leaves id absent when the token has no subject", () => {
    const session = applyTokenToSession<TestSession>(
      { user: { name: "Alice" } },
      { role: "member" },
    );
    expect(session.user).not.toHaveProperty("id");
  });

  it("preserves other session fields", () => {
    const session = applyTokenToSession<TestSession>(
      { expires: "2026-01-01", user: { email: "a@b.c" } },
      { sub: "u1", role: "member" },
    );
    expect(session.expires).toBe("2026-01-01");
    expect(session.user?.email).toBe("a@b.c");
  });
});

describe("applyUpdateToToken", () => {
  const token = { sub: "u1", role: "member" as const, deactivated: false };

  it("takes a new, trimmed display name", () => {
    expect(applyUpdateToToken(token, { name: " Alice Tan " })).toEqual({
      ...token,
      name: "Alice Tan",
    });
  });

  it("ignores anything that is not a valid name, and never takes other claims", () => {
    expect(applyUpdateToToken(token, { name: "  " })).toBe(token);
    expect(applyUpdateToToken(token, { name: 7 })).toBe(token);
    expect(applyUpdateToToken(token, undefined)).toBe(token);
    expect(applyUpdateToToken(token, null)).toBe(token);
    expect(applyUpdateToToken(token, { role: "admin" })).toBe(token);
    expect(applyUpdateToToken(token, { name: "A", role: "admin" }).role).toBe("member");
  });
});
