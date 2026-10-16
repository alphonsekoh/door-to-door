import { goTo } from "@/lib/navigate";
import { clearLocalCopy } from "@/lib/offline/local-copy-store";
import { clearServiceWorkerCaches } from "@/lib/sw-client";

/*
 * Leaving the app on a phone somebody else may pick up next.
 *
 * Cached lists and the offline shell's copy are cleared first (never the
 * queue, D-33-1), but a failure there must not trap the member
 * in the app: the cookie is what actually protects the account, so the
 * sign-out goes ahead regardless. Clearing first still beats the other order,
 * because a request that fails halfway then costs a cache, not a leftover list.
 *
 * Auth.js is told not to redirect and the page navigates itself, to a relative
 * path: the URL Auth.js hands back is built server-side from the request host,
 * which changed the origin (127.0.0.1 to localhost) behind the standalone
 * server. A full navigation rather than a router push also drops the signed-in
 * page from memory.
 *
 * Auth.js answers a refused sign-out (a CSRF mismatch, say) with 200 and an
 * error page URL, and the session cookie survives. That has to surface as a
 * failure: going to /sign-in would tell the member they were out when the
 * next person to pick up the phone is still signed in as them.
 */
export async function signOutAndForget(
  signOut: (options: { redirect: false }) => Promise<{ url: string }>,
  navigate: (path: string) => void = goTo,
  destination = "/sign-in",
): Promise<void> {
  await clearServiceWorkerCaches().catch(() => undefined);
  await clearLocalCopy().catch(() => undefined);
  const { url } = await signOut({ redirect: false });
  const refusal = new URL(url, "http://relative.invalid").searchParams.get("error");
  if (refusal !== null) {
    throw new Error(`Sign-out was refused: ${refusal}`);
  }
  navigate(destination);
}
