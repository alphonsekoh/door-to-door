import { auth } from "@/../auth";
import type { Role } from "@/db/schema";
import { requireAdmin, requireUser, type SessionUser } from "@/server/auth/guards";

/*
 * Shared preamble for the session handlers. Authorization is re-checked on
 * every call: the proxy is only an optimistic redirect, so a request can reach
 * a handler without having passed through it.
 */
export async function currentUser(role?: Role): Promise<SessionUser> {
  const session = await auth();
  return role === "admin" ? requireAdmin(session) : requireUser(session);
}
