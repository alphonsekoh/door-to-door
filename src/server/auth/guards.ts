import type { Approval, Role } from "@/db/schema";
import { sameUuid } from "@/lib/uuid";
import {
  AccountBlockedError,
  AccountDeactivatedError,
  AccountPendingError,
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
  /* From the database row, like deactivated; the token never carries it. */
  approval?: Approval;
  deactivated?: boolean;
};

/* signInId is the token's claim until resolveSession has checked it (#125). */
export type SessionLike = { user?: Partial<SessionUser> | null; signInId?: unknown } | null;

/*
 * Signed in, and not deactivated. Pure: it believes the session it is given.
 * A JWT issued before an account was deactivated stays cryptographically
 * valid, so callers must pass a session built from the database
 * (currentSession), never the raw token.
 */
function requireAccount(session: SessionLike): Omit<SessionUser, "approval"> & {
  approval: Approval | undefined;
} {
  const user = session?.user;
  if (!user || typeof user.id !== "string" || user.id === "" || user.role === undefined) {
    throw new UnauthenticatedError();
  }
  if (user.deactivated === true) {
    throw new AccountDeactivatedError();
  }
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    role: user.role,
    approval: user.approval,
    deactivated: false,
  };
}

/*
 * The gate every handler passes through (#249): only an approved account
 * gets past it. Anything else is refused, a session with no approval at all
 * included, so a session not read from the database fails closed.
 */
export function requireUser(session: SessionLike): SessionUser {
  const user = requireAccount(session);
  if (user.approval === "blocked") {
    throw new AccountBlockedError();
  }
  if (user.approval !== "approved") {
    throw new AccountPendingError();
  }
  return { ...user, approval: "approved" };
}

/*
 * The caller's own account whatever its approval, for GET and PATCH
 * /users/me only: someone waiting for approval reads their state there and
 * corrects their name. auth-imports.test.ts holds every other file to
 * requireUser.
 */
export function requireOwnAccount(
  session: SessionLike,
): Omit<SessionUser, "approval"> & { approval: Approval } {
  const user = requireAccount(session);
  return { ...user, approval: user.approval ?? "pending" };
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
    user.approval === "approved" &&
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
  if (requestedMemberId !== undefined && !sameUuid(requestedMemberId, user.id)) {
    throw new ForbiddenError("You can only view your own records.");
  }
  return user.id;
}
