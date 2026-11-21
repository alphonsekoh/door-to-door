import { cache } from "react";
import { auth } from "@/auth";
import { getDatabase, type Database } from "@/db/client";
import type { Role } from "@/db/schema";
import {
  requireAdmin,
  requireUser,
  type SessionLike,
  type SessionUser,
} from "@/server/auth/guards";
import { checkSignIn } from "@/server/auth/sign-ins";
import { AccountDeactivatedError, UnauthenticatedError } from "@/server/http/errors";

/*
 * Where a request's identity is decided.
 *
 * The JWT proves who the caller is; it does not say what they may do now. Its
 * role and deactivated claims are written at sign-in and stay valid until the
 * token expires, so trusting them would leave a deactivated account working
 * and a demoted admin still an admin. Both are read from the database here,
 * on every request, with the token's sign-in in the same query: a sign-in
 * that has ended (signed out, ended by an admin, or by a deactivation) is
 * signed out however long its token has left (#125).
 *
 * Deliberately uncached across requests. Any TTL is a window in which a
 * deactivated account still works, and the cache would be per-process, so
 * with several instances it could not even promise that window.
 *
 * Returning a SessionLike keeps requireUser/requireRole/requireAdmin pure.
 */

type ResolvedUser = Required<Pick<SessionUser, "id" | "email" | "name" | "role" | "approval">>;

/* A deactivated account carries no sign-in: it may not use one. */
export type ResolvedSession =
  | { user: ResolvedUser & { deactivated: false }; signInId: string }
  | { user: ResolvedUser & { deactivated: true } };

export async function resolveSession(
  db: Database,
  session: SessionLike,
): Promise<ResolvedSession | null> {
  const id = session?.user?.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }

  const checked = await checkSignIn(db, id, session?.signInId);
  // The token outlived the account, or its sign-in ended: signed out, not an error.
  if (checked.status === "no-user" || checked.status === "ended") {
    return null;
  }
  const { email, name, role, approval } = checked.account;
  if (checked.status === "deactivated") {
    return { user: { id, email, name, role, approval, deactivated: true } };
  }
  return {
    user: { id, email, name, role, approval, deactivated: false },
    signInId: checked.signInId,
  };
}

/*
 * A lookup failure propagates: it must surface as a 500, never as "allowed".
 *
 * One check per render, not per caller: an admin page's layout and the page
 * itself both ask, and React's cache hands the second the first's answer
 * (#252). That cache lives as long as one server render of one request, and
 * outside a render, as in a route handler, it keeps nothing, so every request
 * still checks the database as D-83-6 requires.
 */
export const currentSession: () => Promise<ResolvedSession | null> = cache(async () => {
  // auth() first: it opts the page into dynamic rendering, so the database
  // (and config.yaml) are never touched while `next build` prerenders.
  const session = await auth();
  // Signed out: nothing to look up, so no pool is opened for it.
  if (session === null) {
    return null;
  }
  return resolveSession(getDatabase(), session);
});

export async function currentUser(role?: Role): Promise<SessionUser> {
  const session = await currentSession();
  return role === "admin" ? requireAdmin(session) : requireUser(session);
}

/* The caller and the sign-in making this request, for the handlers that act on sign-ins. */
export async function currentSignIn(role?: Role): Promise<{ user: SessionUser; signInId: string }> {
  const session = await currentSession();
  if (session === null) {
    throw new UnauthenticatedError();
  }
  if (!("signInId" in session)) {
    throw new AccountDeactivatedError();
  }
  const user = role === "admin" ? requireAdmin(session) : requireUser(session);
  return { user, signInId: session.signInId };
}
