import { describe, expect, it } from "vitest";
import {
  isAdmin,
  requireAdmin,
  requireRole,
  requireUser,
  resolveMemberScope,
  type SessionLike,
} from "@/server/auth/guards";
import {
  AccountDeactivatedError,
  ForbiddenError,
  UnauthenticatedError,
} from "@/server/http/errors";

const session = (user: Record<string, unknown> | null): SessionLike =>
  user === null ? null : { user };

const admin = session({ id: "a1", role: "admin", deactivated: false });
const member = session({ id: "m1", role: "member", deactivated: false });

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
    expect(requireUser(session({ id: "m1", role: "member" }))).toMatchObject({
      email: null,
      name: null,
    });
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
    expect(isAdmin(session({ id: "a1", role: "admin", deactivated: true }))).toBe(false);
  });
});

describe("resolveMemberScope", () => {
  it("scopes a member to their own id", () => {
    expect(resolveMemberScope(member)).toBe("m1");
  });

  it("lets a member ask for their own id explicitly", () => {
    expect(resolveMemberScope(member, "m1")).toBe("m1");
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
