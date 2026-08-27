import { describe, expect, it } from "vitest";
import { deriveRoleState } from "@/lib/use-role";

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
});
