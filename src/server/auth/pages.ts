import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/server/auth/guards";
import { currentSession } from "@/server/auth/session";

/*
 * Keeps a member off the admin screens.
 *
 * This is not the authorization boundary - every handler re-checks with
 * requireAdmin, and the API is reachable without passing here. It exists so a
 * member who follows a link is told the page does not exist rather than being
 * shown a shell whose every request comes back 403.
 *
 * notFound rather than a redirect: the admin area should not advertise itself.
 * A request with no live sign-in is the exception. The proxy lets an ended
 * sign-in's cookie through (it has no database), so an admin signed out
 * elsewhere, or by this release (#125), would otherwise meet a 404 on their
 * own screens; they are sent to sign in, as the API's first 401 would.
 */
export async function requireAdminPage(): Promise<void> {
  const session = await currentSession();
  if (session === null) {
    redirect("/sign-in?reason=signed-out");
  }
  if (!isAdmin(session)) {
    notFound();
  }
}
