/*
 * The domains Google sign-in is for (#14): config.yaml's auth.google.domains,
 * handed to the forms as props. Google speaks for an address only at
 * gmail.com or on a Google Workspace domain; anywhere else the mailbox can
 * pass to someone new while the old holder's Google account still names it.
 * The server enforces this; the forms only say so.
 */

/* Lower-cased; empty for something that is not an address. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function inGoogleDomains(email: string, domains: readonly string[]): boolean {
  return domains.includes(emailDomain(email));
}

/* "gmail.com", "gmail.com or tjc.sg", "gmail.com, tjc.sg or tjc.org". */
export function listDomains(domains: readonly string[]): string {
  const rest = domains.slice(0, -1);
  const last = domains.slice(-1).join("");
  return rest.length === 0 ? last : `${rest.join(", ")} or ${last}`;
}

export const GOOGLE_NOT_SET_UP_MESSAGE =
  "Google sign-in isn't set up here, so they need a password.";

export function outsideGoogleDomainsMessage(domains: readonly string[]): string {
  return `Google sign-in works only for addresses at ${listDomains(domains)}, so they need a password.`;
}
