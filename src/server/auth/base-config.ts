import type { NextAuthConfig } from "next-auth";
import { applyTokenToSession, applyUpdateToToken, applyUserToToken } from "@/server/auth/callbacks";

export type BaseAuthSettings = {
  authSecret: string;
  auth: { trustHost: boolean; secureCookies: boolean };
};

/*
 * Everything Auth.js needs that does not touch the database.
 *
 * Kept separate so the proxy can build an Auth.js instance without the Drizzle
 * adapter: sessions are JWTs, so verifying one needs no database, and the
 * proxy has no reason to open a connection pool.
 *
 * The secret and trustHost are passed explicitly rather than left to Auth.js's
 * own AUTH_* lookups, because the secret may arrive through AUTH_SECRET_FILE
 * and Auth.js knows nothing of that.
 *
 * useSecureCookies is passed too, so the route handlers and the proxy agree on
 * the cookie names whatever scheme the request arrived with: the __Secure-
 * session cookie one issues is the one the other looks for.
 */
export function buildBaseAuthConfig({ authSecret, auth }: BaseAuthSettings) {
  return {
    session: {
      /*
       * Required, not preferred: the Credentials provider cannot use database
       * sessions. auth_sessions therefore exists only to satisfy the adapter's
       * contract and is unused at runtime.
       */
      strategy: "jwt",
      maxAge: 60 * 60 * 24 * 30,
    },
    pages: {
      signIn: "/sign-in",
      error: "/sign-in",
    },
    callbacks: {
      jwt({ token, user, trigger, session }) {
        return trigger === "update"
          ? applyUpdateToToken(token, session)
          : applyUserToToken(token, user);
      },
      session({ session, token }) {
        return applyTokenToSession(session, token);
      },
    },
    secret: authSecret,
    trustHost: auth.trustHost,
    useSecureCookies: auth.secureCookies,
    // Providers are supplied by each consumer: the full config adds
    // credentials, the proxy needs none to verify a JWT.
    providers: [],
  } satisfies NextAuthConfig;
}
