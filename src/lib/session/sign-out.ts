import { replaceWith } from "@/lib/session/navigate";
import { clearLocalCopy } from "@/lib/offline/local-copy-store";
import { clearServiceWorkerCaches } from "@/lib/pwa/sw-client";
import { forgetSentRecords } from "@/lib/sync/forget-sent";
import { fetchSignedIn } from "@/lib/sync/signed-in";

type SignOut = (options: { redirect: false }) => Promise<{ url: string }>;

/*
 * The answer to any request the proxy sees with a session sets the cookie
 * again, refreshed by its session check, and a sign-out cannot take the
 * token back (D-83-15). So the answer to a request sent just before signing
 * out, arriving just after, puts the cookie back. Each can do that once, and
 * a page has only a few in flight, so a session still there after this many
 * sign-outs is not going away.
 */
const MAX_SIGN_OUTS = 3;

/* The check only confirms a sign-out that already succeeded, so on weak
   signal it should not hold the member on "Signing out…" as long as a send
   may take. */
const CHECK_WITHIN_MS = 5_000;

/* Set as a sign-out leaves for the sign-in page, which checks once more. */
const JUST_SIGNED_OUT = "d2d:just-signed-out";

async function signOutOnce(signOut: SignOut): Promise<void> {
  const { url } = await signOut({ redirect: false });
  const refusal = new URL(url, "http://relative.invalid").searchParams.get("error");
  if (refusal !== null) {
    throw new Error(`Sign-out was refused: ${refusal}`);
  }
}

/* Only an answer naming someone counts. An unanswered check leaves the
   sign-out standing: it succeeded, and the sign-in page asks again. */
async function someoneSignedIn(): Promise<boolean> {
  const answer = await fetchSignedIn(CHECK_WITHIN_MS);
  return answer.kind === "member" && answer.id !== null;
}

async function signOutForGood(signOut: SignOut): Promise<void> {
  for (let attempt = 0; attempt < MAX_SIGN_OUTS; attempt += 1) {
    await signOutOnce(signOut);
    if (!(await someoneSignedIn())) return;
  }
  throw new Error("The session came back after signing out");
}

/* Storage that cannot be used (private browsing, say) costs only the
   sign-in page's second look. */
function noteSignOut(present: boolean): void {
  try {
    if (present) window.sessionStorage.setItem(JUST_SIGNED_OUT, "1");
    else window.sessionStorage.removeItem(JUST_SIGNED_OUT);
  } catch {
    /* As above. */
  }
}

function signedOutJustNow(): boolean {
  try {
    return window.sessionStorage.getItem(JUST_SIGNED_OUT) !== null;
  } catch {
    return false;
  }
}

/*
 * Leaving the app on a phone somebody else may pick up next.
 *
 * Cached lists, the offline shell's copy and records already sent are cleared
 * first (never an unsent record, D-33-1), but a failure there must not trap
 * the member in the app: the cookie is what actually protects the account, so
 * the sign-out goes ahead regardless. Clearing first still beats the other
 * order, because a request that fails halfway then costs a cache, not a
 * leftover list.
 *
 * Auth.js is told not to redirect and the page navigates itself, to a relative
 * path: the URL Auth.js hands back is built server-side from the request host,
 * which changed the origin (127.0.0.1 to localhost) behind the standalone
 * server. A full navigation rather than a router push also drops the signed-in
 * page from memory, and replacing the history entry rather than adding one
 * means Back does not lead to it either.
 *
 * Auth.js answers a refused sign-out (a CSRF mismatch, say) with 200 and an
 * error page URL, and the session cookie survives. That has to surface as a
 * failure: going to /sign-in would tell the member they were out when the
 * next person to pick up the phone is still signed in as them. So does a
 * session that keeps coming back.
 */
export async function signOutAndForget(
  signOut: SignOut,
  destination = "/sign-in",
  navigate: (path: string) => void = replaceWith,
): Promise<void> {
  await clearServiceWorkerCaches().catch(() => undefined);
  await clearLocalCopy().catch(() => undefined);
  await forgetSentRecords().catch(() => undefined);
  await signOutForGood(signOut);
  noteSignOut(true);
  navigate(destination);
}

/*
 * The sign-in page's second look after a sign-out. The page that signed out
 * lives until this one replaces it, and an answer to one of its requests can
 * still arrive meanwhile; once this page is up, those requests have gone with
 * it. Only one a service worker is still fetching could come later, which
 * only revoking the token on the server would rule out.
 *
 * Throws, like a sign-out, when the session it finds will not go. Either way
 * it looks only once, so a member who signs in after it cannot be signed out
 * by a later visit here.
 */
export async function finishSignOut(signOut: SignOut): Promise<void> {
  if (!signedOutJustNow()) return;
  try {
    if (await someoneSignedIn()) await signOutForGood(signOut);
  } finally {
    noteSignOut(false);
  }
}
