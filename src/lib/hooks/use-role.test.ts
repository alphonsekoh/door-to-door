import { describe, expect, it } from "vitest";
import { deriveRoleState } from "@/lib/hooks/use-role";

describe("deriveRoleState", () => {
  it("reports an admin", () => {
    expect(deriveRoleState("authenticated", { id: "u1", role: "admin" })).toMatchObject({
      userId: "u1",
      isAdmin: true,
      isMember: false,
      isSignedIn: true,
      isLoading: false,
    });
  });

  it("reports a member", () => {
    expect(deriveRoleState("authenticated", { id: "u2", role: "member" })).toMatchObject({
      userId: "u2",
      isAdmin: false,
      isMember: true,
    });
  });

  it("reports loading before the session resolves", () => {
    // Without this the UI flashes member-only chrome at an admin.
    expect(deriveRoleState("loading")).toMatchObject({
      isLoading: true,
      isSignedIn: false,
      isAdmin: false,
      userId: undefined,
    });
  });

  it("reports nobody when unauthenticated", () => {
    expect(deriveRoleState("unauthenticated")).toMatchObject({
      isSignedIn: false,
      isAdmin: false,
      isMember: false,
      role: undefined,
      userId: undefined,
    });
  });

  it("treats a deactivated account as signed out", () => {
    expect(
      deriveRoleState("authenticated", { id: "u1", role: "admin", deactivated: true }),
    ).toMatchObject({
      isSignedIn: false,
      isAdmin: false,
      role: undefined,
      userId: undefined,
    });
  });

  it("does not report a role for an unauthenticated status even if one is present", () => {
    // A stale cached role must not grant admin chrome after sign-out.
    expect(deriveRoleState("unauthenticated", { id: "u1", role: "admin" }).isAdmin).toBe(false);
  });

  it("reports an authenticated user whose role has not arrived as neither", () => {
    expect(deriveRoleState("authenticated", { id: "u1" })).toMatchObject({
      userId: "u1",
      role: undefined,
      isAdmin: false,
      isMember: false,
      isSignedIn: true,
    });
  });

  describe("with the role /users/me last returned", () => {
    it("shows a demoted admin as a member", () => {
      expect(
        deriveRoleState("authenticated", { id: "u1", role: "admin" }, { id: "u1", role: "member" }),
      ).toMatchObject({ role: "member", isAdmin: false, isMember: true });
    });

    it("shows a promoted member as an admin", () => {
      expect(
        deriveRoleState("authenticated", { id: "u1", role: "member" }, { id: "u1", role: "admin" }),
      ).toMatchObject({ role: "admin", isAdmin: true });
    });

    it("ignores a record for a different account", () => {
      // A second member signing in on the same phone must not inherit it.
      expect(
        deriveRoleState("authenticated", { id: "u2", role: "admin" }, { id: "u1", role: "member" }),
      ).toMatchObject({ userId: "u2", role: "admin", isAdmin: true });
    });

    it("keeps the token's role when nothing has been read yet", () => {
      expect(deriveRoleState("authenticated", { id: "u1", role: "admin" }, null)).toMatchObject({
        isAdmin: true,
      });
    });

    it("gives no role at all once signed out", () => {
      expect(
        deriveRoleState(
          "unauthenticated",
          { id: "u1", role: "admin" },
          { id: "u1", role: "admin" },
        ),
      ).toMatchObject({ role: undefined, isAdmin: false, isSignedIn: false });
    });
  });
});
