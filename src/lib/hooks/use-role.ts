"use client";

import { useSession } from "next-auth/react";
import { useSyncExternalStore } from "react";
import type { Role } from "@/db/schema";
import { type ServerUser, accountStore } from "@/lib/session/account-state";

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

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

function signedIn(status: SessionStatus, user: SessionUser | undefined): boolean {
  return status === "authenticated" && user?.deactivated !== true;
}

function deriveRole(
  status: SessionStatus,
  user: SessionUser | undefined,
  serverUser: ServerUser | null | undefined,
): Role | undefined {
  if (!signedIn(status, user)) return undefined;
  /* The token's role is a hint set at sign-in (D-83-3); the latest /users/me
     for the same account wins, so a demotion or promotion shows without
     signing in again. */
  return serverUser != null && serverUser.id === user?.id ? serverUser.role : user?.role;
}

function roleState(
  status: SessionStatus,
  user: SessionUser | undefined,
  role: Role | undefined,
): RoleState {
  const isSignedIn = signedIn(status, user);
  return {
    userId: isSignedIn ? user?.id : undefined,
    role,
    isAdmin: role === "admin",
    isMember: role === "member",
    isLoading: status === "loading",
    isSignedIn,
  };
}

export function deriveRoleState(
  status: SessionStatus,
  user?: SessionUser,
  serverUser?: ServerUser | null,
): RoleState {
  return roleState(status, user, deriveRole(status, user, serverUser));
}

export function useRole(): RoleState {
  const { data, status } = useSession();
  const user = data?.user;
  /* The role, not the store's snapshot: a store's change is drawn at once,
     transition or not, so a /users/me that agrees with the token would draw
     every screen again for nothing, and one landing as text lands in the
     unit field would put the unit back (#155). */
  const role = useSyncExternalStore(
    accountStore.subscribe,
    () => deriveRole(status, user, accountStore.getSnapshot().serverUser),
    () => deriveRole(status, user, accountStore.getServerSnapshot().serverUser),
  );
  return roleState(status, user, role);
}
