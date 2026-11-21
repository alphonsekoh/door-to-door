import { listDomains } from "@/lib/session/google-domains";

/*
 * What the sign-in page says when Auth.js sends a Google sign-in back to it
 * with ?error= (#14). The value is Auth.js's error type, and the query string
 * is anyone's to write, so it only ever picks between two fixed messages and
 * is never shown itself.
 *
 * AccessDenied is every refusal: an address Google has not verified or does
 * not vouch for, a deactivated account. Anyone else Google vouches for may
 * ask to join (#249), so the message no longer speaks of addresses an admin
 * added. It stays one message, as Auth.js passes the page nothing but its
 * own error type, and names the domains Google sign-in is for, which are the
 * same for everyone.
 */

/* Kept short: at the largest text, less to scroll past to the sign-in buttons. */
export function googleRefusedMessage(domains: readonly string[]): string {
  return (
    "That Google account can't sign in here. Google sign-in is for " +
    `${listDomains(domains)} accounts; otherwise, use your email and password.`
  );
}

export const GOOGLE_UNFINISHED =
  "Google sign-in didn't finish. Try again, or sign in with your email and password.";

export function googleSignInMessage(
  error: string | null,
  domains: readonly string[],
): string | null {
  if (error === null) return null;
  return error === "AccessDenied" ? googleRefusedMessage(domains) : GOOGLE_UNFINISHED;
}
