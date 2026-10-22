import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDatabase, type Database } from "@/db/client";
import { users, type Role } from "@/db/schema";
import {
  requireAdmin,
  requireUser,
  type SessionLike,
  type SessionUser,
} from "@/server/auth/guards";

/*
 * Where a request's identity is decided.
 *
 * The JWT proves who the caller is; it does not say what they may do now. Its
 * role and deactivated claims are written at sign-in and stay valid until the
 * token expires, so trusting them would leave a deactivated account working
 * and a demoted admin still an admin. Both are read from the database here,
 * on every request: one primary-key lookup.
 *
 * Deliberately uncached. Any TTL is a window in which a deactivated account
 * still works, and the cache would be per-process, so with several instances
 * it could not even promise that window.
 *
 * Returning a SessionLike keeps requireUser/requireRole/requireAdmin pure.
 */
export async function resolveSession(db: Database, session: SessionLike): Promise<SessionLike> {
  const id = session?.user?.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }

  const rows = await db
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  const row = rows[0];
  // The token outlived the account: treated as signed out, not as an error.
  if (!row) {
    return null;
  }
  return {
    user: {
      id,
      email: row.email,
      name: row.name,
      role: row.role,
      deactivated: row.deactivatedAt !== null,
    },
  };
}

/* A lookup failure propagates: it must surface as a 500, never as "allowed". */
export async function currentSession(): Promise<SessionLike> {
  // auth() first: it opts the page into dynamic rendering, so the database
  // (and config.yaml) are never touched while `next build` prerenders.
  const session = await auth();
  // Signed out: nothing to look up, so no pool is opened for it.
  if (session === null) {
    return null;
  }
  return resolveSession(getDatabase(), session);
}

export async function currentUser(role?: Role): Promise<SessionUser> {
  const session = await currentSession();
  return role === "admin" ? requireAdmin(session) : requireUser(session);
}
