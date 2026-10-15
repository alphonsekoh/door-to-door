"use client";

import { useSession } from "next-auth/react";
import { useSyncExternalStore } from "react";
import type { Role } from "@/db/schema";
import { type ServerUser, accountStore } from "@/lib/account-state";

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
  serverUser?: ServerUser | null,
): RoleState {
  const isSignedIn = status === "authenticated" && user?.deactivated !== true;
  /* The token's role is a hint set at sign-in (D-83-3); the latest /users/me
     for the same account wins, so a demotion or promotion shows without
     signing in again. */
  const sameAccount = isSignedIn && serverUser != null && serverUser.id === user?.id;
  const role = sameAccount ? serverUser.role : isSignedIn ? user?.role : undefined;
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
  const { serverUser } = useSyncExternalStore(
    accountStore.subscribe,
    accountStore.getSnapshot,
    accountStore.getServerSnapshot,
  );
  return deriveRoleState(status, data?.user, serverUser);
}
