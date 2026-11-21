import { notFound, redirect } from "next/navigation";
import type { Approval } from "@/db/schema";
import { isAdmin } from "@/server/auth/guards";
import { WAITING_PATH } from "@/server/auth/routes";
import { currentSession } from "@/server/auth/session";

const SIGN_IN_AGAIN = "/sign-in?reason=signed-out";

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
 * own screens; they are sent to sign in, as the API's first 401 would. An
 * account nobody has approved yet is the other (#249): it is sent to the
 * one page it may see.
 */
export async function requireAdminPage(): Promise<void> {
  const session = await currentSession();
  if (session === null) {
    redirect(SIGN_IN_AGAIN);
  }
  if (session.user.approval !== "approved") {
    redirect(WAITING_PATH);
  }
  if (!isAdmin(session)) {
    notFound();
  }
}

export type WaitingAccount = {
  email: string | null;
  name: string | null;
  approval: Exclude<Approval, "approved">;
};

/*
 * The waiting page's account, read from the database like every request
 * (#249). Anyone approved has nothing to wait for and goes home, where a
 * deactivated account is told so by the first request its screens make.
 */
export async function requireWaitingPage(): Promise<WaitingAccount> {
  const session = await currentSession();
  if (session === null) {
    redirect(SIGN_IN_AGAIN);
  }
  const { email, name, approval } = session.user;
  if (approval === "approved") {
    redirect("/");
  }
  return { email, name, approval };
}
