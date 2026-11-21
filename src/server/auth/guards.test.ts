import { describe, expect, it } from "vitest";
import {
  isAdmin,
  requireAdmin,
  requireOwnAccount,
  requireRole,
  requireUser,
  resolveMemberScope,
  type SessionLike,
} from "@/server/auth/guards";
import {
  AccountBlockedError,
  AccountDeactivatedError,
  AccountPendingError,
  ForbiddenError,
  UnauthenticatedError,
} from "@/server/http/errors";

const session = (user: Record<string, unknown> | null): SessionLike =>
  user === null ? null : { user };

const admin = session({ id: "a1", role: "admin", approval: "approved", deactivated: false });
const member = session({ id: "m1", role: "member", approval: "approved", deactivated: false });
const pending = session({ id: "p1", role: "member", approval: "pending", deactivated: false });
const blocked = session({ id: "b1", role: "member", approval: "blocked", deactivated: false });

describe("requireUser", () => {
  it("returns the signed-in user", () => {
    expect(requireUser(member)).toMatchObject({ id: "m1", role: "member" });
  });

  it.each<[string, Record<string, unknown> | null]>([
    ["no session at all", null],
    ["a session with no user", {}],
    ["a user with no id", { role: "member" }],
    ["a user with an empty id", { id: "", role: "member" }],
    ["a user with no role", { id: "m1" }],
  ])("rejects %s", (_case, user) => {
    expect(() => requireUser(session(user))).toThrow(UnauthenticatedError);
  });

  it("rejects an account deactivated after its session was issued", () => {
    /*
     * The JWT stays cryptographically valid, so this cannot be caught at
     * sign-in. It is why the contract documents 403 account_deactivated on
     * every operation.
     */
    expect(() => requireUser(session({ id: "m1", role: "member", deactivated: true }))).toThrow(
      AccountDeactivatedError,
    );
  });

  it("distinguishes deactivated from merely unauthenticated", () => {
    // A deactivated user should be told to talk to an admin, not to sign in
    // again - repeated sign-in attempts would never succeed.
    try {
      requireUser(session({ id: "m1", role: "member", deactivated: true }));
    } catch (error) {
      expect((error as AccountDeactivatedError).code).toBe("account_deactivated");
      expect((error as AccountDeactivatedError).status).toBe(403);
    }
  });

  it("normalises absent email and name to null", () => {
    expect(requireUser(session({ id: "m1", role: "member", approval: "approved" }))).toMatchObject({
      email: null,
      name: null,
    });
  });
});

/* #249: the one gate every handler passes through. */
describe("requireUser, for an account nobody has approved", () => {
  it.each<[string, SessionLike, unknown, string]>([
    ["waiting for approval", pending, AccountPendingError, "account_pending"],
    ["rejected", blocked, AccountBlockedError, "account_blocked"],
  ])("refuses an account %s, with its own code", (_case, refused, type, code) => {
    expect(() => requireUser(refused)).toThrow(type);
    try {
      requireUser(refused);
    } catch (error) {
      expect((error as AccountPendingError).status).toBe(403);
      expect((error as AccountPendingError).code).toBe(code);
    }
  });

  it("fails closed for a session that says nothing about approval", () => {
    /* Only a session read from the database carries approval; anything else
       is refused rather than let through. */
    expect(() => requireUser(session({ id: "m1", role: "member" }))).toThrow(AccountPendingError);
    expect(() =>
      requireUser(session({ id: "m1", role: "member", approval: "approved-ish" })),
    ).toThrow(AccountPendingError);
  });

  it("refuses an unapproved caller before any role check", () => {
    expect(() => requireAdmin(pending)).toThrow(AccountPendingError);
    expect(() => requireRole(blocked, "member")).toThrow(AccountBlockedError);
    expect(() => resolveMemberScope(pending)).toThrow(AccountPendingError);
  });

  it("still tells a deactivated account it is deactivated first", () => {
    expect(() =>
      requireUser(session({ id: "m1", role: "member", approval: "pending", deactivated: true })),
    ).toThrow(AccountDeactivatedError);
  });
});

describe("requireOwnAccount (#249)", () => {
  it.each([
    ["approved", member],
    ["pending", pending],
    ["blocked", blocked],
  ])("lets an account through whatever its approval: %s", (approval, own) => {
    expect(requireOwnAccount(own)).toMatchObject({ approval, deactivated: false });
  });

  it("reads a session that says nothing about approval as waiting", () => {
    expect(requireOwnAccount(session({ id: "m1", role: "member" })).approval).toBe("pending");
  });

  it("still refuses the signed out and the deactivated", () => {
    expect(() => requireOwnAccount(null)).toThrow(UnauthenticatedError);
    expect(() => requireOwnAccount(session({ id: "", role: "member" }))).toThrow(
      UnauthenticatedError,
    );
    expect(() =>
      requireOwnAccount(
        session({ id: "m1", role: "member", approval: "approved", deactivated: true }),
      ),
    ).toThrow(AccountDeactivatedError);
  });
});

describe("requireRole", () => {
  it("admits the matching role", () => {
    expect(requireRole(admin, "admin").id).toBe("a1");
  });

  it("rejects a member reaching for an admin operation", () => {
    // The acceptance criterion: a direct API call from a member gets 403.
    expect(() => requireRole(member, "admin")).toThrow(ForbiddenError);
  });

  it("rejects an admin where a member is required", () => {
    expect(() => requireRole(admin, "member")).toThrow(ForbiddenError);
  });

  it("rejects before checking the role when unauthenticated", () => {
    expect(() => requireRole(null, "admin")).toThrow(UnauthenticatedError);
  });

  it("rejects a deactivated admin", () => {
    expect(() =>
      requireRole(session({ id: "a1", role: "admin", deactivated: true }), "admin"),
    ).toThrow(AccountDeactivatedError);
  });
});

describe("requireAdmin", () => {
  it("admits an admin", () => {
    expect(requireAdmin(admin).role).toBe("admin");
  });

  it("rejects a member", () => {
    expect(() => requireAdmin(member)).toThrow(ForbiddenError);
  });
});

describe("isAdmin", () => {
  it("is true for an admin", () => {
    expect(isAdmin(admin)).toBe(true);
  });

  it("is false for a member", () => {
    expect(isAdmin(member)).toBe(false);
  });

  it("is false with no session", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it.each([{ role: "admin" }, { id: "", role: "admin" }])(
    "is false for an admin claim with no usable id: %j",
    (user) => {
      expect(isAdmin(session(user))).toBe(false);
    },
  );

  it("is false for a deactivated admin", () => {
    expect(
      isAdmin(session({ id: "a1", role: "admin", approval: "approved", deactivated: true })),
    ).toBe(false);
  });

  it.each(["pending", "blocked", undefined])(
    "is false for an admin claim whose approval is %s (#249)",
    (approval) => {
      expect(isAdmin(session({ id: "a1", role: "admin", approval }))).toBe(false);
    },
  );
});

describe("resolveMemberScope", () => {
  it("scopes a member to their own id", () => {
    expect(resolveMemberScope(member)).toBe("m1");
  });

  it("lets a member ask for their own id explicitly", () => {
    expect(resolveMemberScope(member, "m1")).toBe("m1");
  });

  it("knows a member's own id in either letter case, and scopes to the session's", () => {
    // The contract takes a uuid in capitals; the session's id is lower case.
    expect(resolveMemberScope(member, "M1")).toBe("m1");
  });

  it("refuses a member asking for someone else's records", () => {
    // No parameter combination may widen a member's view.
    expect(() => resolveMemberScope(member, "m2")).toThrow(ForbiddenError);
  });

  it("lets an admin target any member", () => {
    expect(resolveMemberScope(admin, "m2")).toBe("m2");
  });

  it("defaults an admin to their own id", () => {
    expect(resolveMemberScope(admin)).toBe("a1");
  });

  it("rejects an unauthenticated caller", () => {
    expect(() => resolveMemberScope(null, "m1")).toThrow(UnauthenticatedError);
  });
});
