/* next-auth/react's signIn, as the email form calls it. */
type CredentialsSignIn = (
  provider: "credentials",
  options: { email: string; password: string; redirect: false },
) => Promise<{ error: string | undefined }>;

/*
 * "refused" is every refusal about the account: a wrong password, an unknown,
 * deactivated or Google-only email, a spent budget. The form keeps all of
 * those on one message (D-15-1). "expired" is only Auth.js's CSRF check,
 * which it makes before it reads the credentials, so telling it apart says
 * nothing about accounts.
 */
export type PasswordSignIn = "signed-in" | "refused" | "expired";

export const PAGE_EXPIRED = "This page expired. Reload it and try again.";

async function attempt(
  signIn: CredentialsSignIn,
  email: string,
  password: string,
): Promise<PasswordSignIn> {
  const { error } = await signIn("credentials", { email, password, redirect: false });
  if (error === undefined) return "signed-in";
  return error === "MissingCSRF" ? "expired" : "refused";
}

/*
 * A CSRF refusal is sent again once, silently (#151). signIn fetches a fresh
 * token for whatever cookie the phone holds by then, so a cookie swapped
 * since the first token was fetched (by another tab, or WebKit's worker
 * check) passes the second time. The refusal never reaches the credentials
 * check, so it costs no sign-in budget: with the retry, a tap still charges
 * at most one attempt. Only once, so it cannot loop: a phone that keeps no
 * cookie at all would be refused a third time too, and is told to reload.
 */
export async function signInWithPassword(
  signIn: CredentialsSignIn,
  email: string,
  password: string,
): Promise<PasswordSignIn> {
  const first = await attempt(signIn, email, password);
  return first === "expired" ? attempt(signIn, email, password) : first;
}
