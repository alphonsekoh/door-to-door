"use client";

import { useSession } from "next-auth/react";
import type { Role } from "@/db/schema";

/*
 * Role helpers for the UI.
 *
 * For affordance only - deciding what to render. They are never an
 * authorization boundary: every handler re-checks with requireRole, so hiding
 * a button is a courtesy, not a control. Anyone can call the API directly.
 */

export type RoleState = {
  role: Role | undefined;
  isAdmin: boolean;
  isMember: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
};

export function deriveRoleState(
  status: "loading" | "authenticated" | "unauthenticated",
  role: Role | undefined,
  deactivated = false,
): RoleState {
  const isSignedIn = status === "authenticated" && !deactivated;
  return {
    role: isSignedIn ? role : undefined,
    isAdmin: isSignedIn && role === "admin",
    isMember: isSignedIn && role === "member",
    isLoading: status === "loading",
    isSignedIn,
  };
}

export function useRole(): RoleState {
  const { data, status } = useSession();
  return deriveRoleState(status, data?.user.role, data?.user.deactivated);
}
