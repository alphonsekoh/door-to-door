import { AuthError, customFetch } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google, { type GoogleProfile } from "next-auth/providers/google";
import type { Database } from "@/db/client";
import { findUserForSignIn, normaliseEmail } from "@/server/auth/credentials";
import type { AppConfig, RuntimeConfig } from "@/lib/config";
import { emailDomain } from "@/lib/session/google-domains";
import { getConfig } from "@/server/config";

/*
 * Google sign-in (#14). Only someone an admin has already added can use it,
 * and only at an address Google vouches for: signing in never creates an
 * account, and never says whether one exists.
 */

/*
 * Auth.js's own AccessDenied, which next-auth does not export. Its type is
 * what Auth.js puts in ?error= on the way back to /sign-in, so every refusal
 * reads the same there.
 */
export class SignInRefused extends AuthError {
  static type = "AccessDenied";
}

/*
 * The domains Google sign-in is for, or null when it is not set up. Read per
 * request, not at import: `next build` has no config file (D-13-4).
 */
export function googleDomains(): readonly string[] | null {
  return getConfig().auth.google?.domains ?? null;
}

/*
 * The provider, or none when config.yaml has no auth.google. `fetchImpl` lets
 * a test stand in for Google's servers; nothing else passes one.
 */
export function googleProviders(config: RuntimeConfig, fetchImpl?: typeof fetch) {
  const google = config.auth.google;
  if (google === undefined) return [];
  /* loadConfig already refuses this; a config built any other way must too,
     rather than send Google a client id with no secret. */
  const clientSecret = config.googleClientSecret;
  if (clientSecret === undefined) {
    throw new Error("auth.google is set but AUTH_GOOGLE_SECRET is not.");
  }
  return [
    Google({
      clientId: google.clientId,
      clientSecret,
      ...(google.issuer === undefined ? {} : { issuer: google.issuer }),
      /* Safe here, where it is usually not: only an address an admin added can
         sign in, and only one Google vouches for (allowGoogleSignIn). */
      allowDangerousEmailAccountLinking: true,
      /* Every time, so on a shared phone the next member picks their own
         account rather than being signed in silently as the last one. */
      authorization: { params: { prompt: "select_account" } },
      /* Used only to find the account by email; Google never sets a name,
         address or picture here. */
      profile: (profile: GoogleProfile) => ({
        id: profile.sub,
        email: normaliseEmail(profile.email),
        name: null,
        image: null,
      }),
      /* No Google tokens are kept: nothing here calls Google on anyone's behalf. */
      account: () => ({}),
      ...(fetchImpl === undefined ? {} : { [customFetch]: fetchImpl }),
    }),
  ];
}

type Claimed = { email?: string | null } | undefined;
type Asserted = { email?: unknown; email_verified?: unknown; hd?: unknown } | undefined;
type GoogleSettings = Pick<NonNullable<AppConfig["auth"]["google"]>, "domains"> | undefined;

const GMAIL = "gmail.com";

/*
 * Whether Google speaks for this address now, not just once. It does for
 * every gmail.com address. Anywhere else, `email_verified` means only that
 * the address was checked when the Google account was made: if the mailbox
 * later passes to someone else, the old holder could sign in as its member,
 * for good once linked. So there the account must be the domain's own Google
 * Workspace account, which `hd` names. `hd` is the Workspace's primary
 * domain, which a secondary domain's accounts carry too, so it need only be
 * listed, not equal to the address's domain. A consumer Google account on a
 * listed domain, or a listed domain that is not on Workspace, has no `hd`
 * and is refused.
 */
function googleVouchesFor(email: string, hd: unknown, domains: readonly string[]): boolean {
  const domain = emailDomain(email);
  if (!domains.includes(domain)) return false;
  return domain === GMAIL || (typeof hd === "string" && domains.includes(hd.toLowerCase()));
}

/*
 * The signIn callback's judgement for Google. `user` is the account Auth.js
 * will sign in: the one already linked to this Google account, or the profile
 * that is about to be linked by email. Refused unless Google has verified the
 * email and vouches for it (googleVouchesFor), an active account has it, and
 * it is that same account, so a Google account linked earlier whose email
 * has since changed cannot sign in as the old one.
 */
export async function allowGoogleSignIn(
  db: Database,
  google: GoogleSettings,
  user: Claimed,
  profile: Asserted,
): Promise<boolean> {
  if (google === undefined) return false;
  if (profile?.email_verified !== true || typeof profile.email !== "string") return false;
  const email = normaliseEmail(profile.email);
  if (!googleVouchesFor(email, profile.hd, google.domains)) return false;
  const found = await findUserForSignIn(db, email);
  if (found?.deactivatedAt !== null) return false;
  return (
    typeof user?.email === "string" && normaliseEmail(user.email) === normaliseEmail(found.email)
  );
}

/*
 * The adapter as Google sign-in may use it. Nobody is created: an unknown
 * email is refused before this, and this refuses again if that ever slips.
 * And no user is read from a cookie already on the phone, which Auth.js would
 * otherwise link the Google account to: on a shared phone, member B's Google
 * would become a way into member A's account.
 */
export function linkByEmailOnly(adapter: Adapter): Adapter {
  return {
    ...adapter,
    createUser: () => Promise.reject(new SignInRefused("Signing in never creates an account.")),
    getUser: () => Promise.resolve(null),
  };
}
