import { clearServiceWorkerCaches } from "@/lib/sw-client";

function goTo(path: string): void {
  window.location.assign(path);
}

/*
 * Leaving the app on a phone somebody else may pick up next.
 *
 * Cached lists are cleared first, but a failure there must not trap the member
 * in the app: the cookie is what actually protects the account, so the
 * sign-out goes ahead regardless. Clearing first still beats the other order,
 * because a request that fails halfway then costs a cache, not a leftover list.
 *
 * Auth.js is told not to redirect and the page navigates itself, to a relative
 * path: the URL Auth.js hands back is built server-side from the request host,
 * which changed the origin (127.0.0.1 to localhost) behind the standalone
 * server. A full navigation rather than a router push also drops the signed-in
 * page from memory.
 */
export async function signOutAndForget(
  signOut: (options: { redirect: false }) => Promise<unknown>,
  navigate: (path: string) => void = goTo,
): Promise<void> {
  await clearServiceWorkerCaches().catch(() => undefined);
  await signOut({ redirect: false });
  navigate("/sign-in");
}
