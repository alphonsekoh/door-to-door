import { listDomains } from "@/lib/session/google-domains";

/*
 * What the sign-in page says when Auth.js sends a Google sign-in back to it
 * with ?error= (#14). The value is Auth.js's error type, and the query string
 * is anyone's to write, so it only ever picks between two fixed messages and
 * is never shown itself.
 *
 * AccessDenied is every refusal: an address nobody added, one Google has not
 * verified or does not vouch for, a deactivated account. One message for all
 * of them, so the page says nothing about who has an account (D-15-1). It
 * names the domains Google sign-in is for, which are the same for everyone.
 */

export function googleRefusedMessage(domains: readonly string[]): string {
  return (
    "That Google account can't sign in here. Use the email address your admin added. " +
    `Google sign-in works only for addresses at ${listDomains(domains)}. ` +
    "For any other address, sign in with your email and password."
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
