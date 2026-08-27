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
  /* Needed to tell "my record" from "someone else's" in a shared block. */
  userId: string | undefined;
  role: Role | undefined;
  isAdmin: boolean;
  isMember: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
};

export type SessionUser = {
  id: string;
  role?: Role | undefined;
  deactivated?: boolean | undefined;
};

export function deriveRoleState(
  status: "loading" | "authenticated" | "unauthenticated",
  user?: SessionUser,
): RoleState {
  const isSignedIn = status === "authenticated" && user?.deactivated !== true;
  const role = isSignedIn ? user?.role : undefined;
  return {
    userId: isSignedIn ? user?.id : undefined,
    role,
    isAdmin: role === "admin",
    isMember: role === "member",
    isLoading: status === "loading",
    isSignedIn,
  };
}

export function useRole(): RoleState {
  const { data, status } = useSession();
  return deriveRoleState(status, data?.user);
}
