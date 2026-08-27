import { describe, expect, it } from "vitest";
import { deriveRoleState } from "@/lib/use-role";

describe("deriveRoleState", () => {
  it("reports an admin", () => {
    expect(deriveRoleState("authenticated", "admin")).toMatchObject({
      isAdmin: true,
      isMember: false,
      isSignedIn: true,
      isLoading: false,
    });
  });

  it("reports a member", () => {
    expect(deriveRoleState("authenticated", "member")).toMatchObject({
      isAdmin: false,
      isMember: true,
    });
  });

  it("reports loading before the session resolves", () => {
    // Without this the UI flashes member-only chrome at an admin.
    expect(deriveRoleState("loading", undefined)).toMatchObject({
      isLoading: true,
      isSignedIn: false,
      isAdmin: false,
    });
  });

  it("reports nobody when unauthenticated", () => {
    expect(deriveRoleState("unauthenticated", undefined)).toMatchObject({
      isSignedIn: false,
      isAdmin: false,
      isMember: false,
      role: undefined,
    });
  });

  it("treats a deactivated account as signed out", () => {
    expect(deriveRoleState("authenticated", "admin", true)).toMatchObject({
      isSignedIn: false,
      isAdmin: false,
      role: undefined,
    });
  });

  it("does not report a role for an unauthenticated status even if one is present", () => {
    // A stale cached role must not grant admin chrome after sign-out.
    expect(deriveRoleState("unauthenticated", "admin").isAdmin).toBe(false);
  });
});
