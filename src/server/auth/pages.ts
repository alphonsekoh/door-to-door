import { notFound } from "next/navigation";
import { auth } from "@/../auth";
import { isAdmin } from "@/server/auth/guards";

/*
 * Keeps a member off the admin screens.
 *
 * This is not the authorization boundary - every handler re-checks with
 * requireAdmin, and the API is reachable without passing here. It exists so a
 * member who follows a link is told the page does not exist rather than being
 * shown a shell whose every request comes back 403.
 *
 * notFound rather than a redirect: the admin area should not advertise itself.
 */
export async function requireAdminPage(): Promise<void> {
  if (!isAdmin(await auth())) {
    notFound();
  }
}
