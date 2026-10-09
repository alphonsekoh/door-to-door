import type { Role } from "@/db/schema";
import {
  AccountDeactivatedError,
  ForbiddenError,
  UnauthenticatedError,
} from "@/server/http/errors";

/*
 * Authorization for route handlers.
 *
 * These are the real guard. The proxy only performs an optimistic redirect,
 * so every handler re-checks here, against the user's current database row
 * (see session.ts) - a request that never passes through the proxy
 * (a direct API call, a stale client) must still be rejected.
 */

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  role: Role;
  deactivated?: boolean;
};

export type SessionLike = { user?: Partial<SessionUser> | null } | null;

export function requireUser(session: SessionLike): SessionUser {
  const user = session?.user;
  if (!user || typeof user.id !== "string" || user.id === "" || user.role === undefined) {
    throw new UnauthenticatedError();
  }

  /*
   * Pure: it believes the session it is given. A JWT issued before an account
   * was deactivated stays cryptographically valid, so callers must pass a
   * session built from the database (currentSession), never the raw token.
   */
  if (user.deactivated === true) {
    throw new AccountDeactivatedError();
  }

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    role: user.role,
    deactivated: false,
  };
}

export function requireRole(session: SessionLike, role: Role): SessionUser {
  const user = requireUser(session);
  if (user.role !== role) {
    throw new ForbiddenError();
  }
  return user;
}

export function requireAdmin(session: SessionLike): SessionUser {
  return requireRole(session, "admin");
}

export function isAdmin(session: SessionLike): boolean {
  const user = session?.user;
  return (
    typeof user?.id === "string" &&
    user.id !== "" &&
    user.role === "admin" &&
    user.deactivated !== true
  );
}

/*
 * Members may only ever reach their own records. Admins may target anyone.
 * Returns the member id a query should be scoped to.
 */
export function resolveMemberScope(session: SessionLike, requestedMemberId?: string): string {
  const user = requireUser(session);
  if (user.role === "admin") {
    return requestedMemberId ?? user.id;
  }
  if (requestedMemberId !== undefined && requestedMemberId !== user.id) {
    throw new ForbiddenError("You can only view your own records.");
  }
  return user.id;
}
