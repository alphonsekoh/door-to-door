/*
 * What the sign-in page says when Auth.js sends a Google sign-in back to it
 * with ?error= (#14). The value is Auth.js's error type, and the query string
 * is anyone's to write, so it only ever picks between two fixed messages and
 * is never shown itself.
 *
 * AccessDenied is every refusal: an address nobody added, one Google has not
 * verified, a deactivated account. One message for all of them, so the page
 * says nothing about who has an account (D-15-1).
 */

export const GOOGLE_REFUSED =
  "That Google account can't sign in here. Use the email address your admin added.";

export const GOOGLE_UNFINISHED =
  "Google sign-in didn't finish. Try again, or sign in with your email and password.";

export function googleSignInMessage(error: string | null): string | null {
  if (error === null) return null;
  return error === "AccessDenied" ? GOOGLE_REFUSED : GOOGLE_UNFINISHED;
}
