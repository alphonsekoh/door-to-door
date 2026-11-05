import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDatabase } from "@/db/client";
import { accounts, authSessions, users, verificationTokens } from "@/db/schema";
import { buildBaseAuthConfig } from "@/server/auth/base-config";
import { applyUserToToken } from "@/server/auth/callbacks";
import { authorizeFromRawCredentials } from "@/server/auth/credentials";
import {
  SignInRefused,
  allowGoogleSignIn,
  googleProviders,
  linkByEmailOnly,
} from "@/server/auth/google";
import { asUuid, checkSignIn, endSignIn, startSignIn } from "@/server/auth/sign-ins";
import { getConfig } from "@/server/config";

/*
 * Auth.js configuration: the adapter, the providers (email and password, and
 * Google when config.yaml sets it up), and the sign-in records of #125.
 */

export type AuthConfigOptions = {
  /* Stands in for Google's servers in tests (#14). */
  googleFetch?: typeof fetch;
};

/*
 * `request` is there only when Auth.js answers one of its own /api/auth
 * routes; the app's auth() calls build the config without one.
 */
export function buildAuthConfig(
  request?: Request,
  options: AuthConfigOptions = {},
): NextAuthConfig {
  const config = getConfig();
  const base = buildBaseAuthConfig(config);
  const db = getDatabase();
  return {
    ...base,
    adapter: linkByEmailOnly(
      DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        // Named auth_sessions in our schema, because outing_sessions is the
        // domain concept and the clash would be confusing.
        sessionsTable: authSessions,
        verificationTokensTable: verificationTokens,
      }),
    ),
    providers: [
      Credentials({
        id: "credentials",
        name: "Email and password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: authorizeFromRawCredentials,
      }),
      ...googleProviders(config, options.googleFetch),
    ],
    callbacks: {
      ...base.callbacks,
      // Credentials have been judged by authorize already.
      signIn: ({ user, account, profile }) =>
        account?.provider === "google" ? allowGoogleSignIn(db, user, profile) : true,
      async jwt(params) {
        const { token, user, trigger } = params;
        /*
         * Each sign-in gets its own record, named on the token for good. An
         * account deactivated since it was judged is refused here, under the
         * lock startSignIn takes.
         */
        if (trigger === "signIn" || trigger === "signUp") {
          const userId = asUuid(user.id);
          const signInId =
            userId === null
              ? null
              : await startSignIn(db, userId, request?.headers.get("user-agent") ?? null);
          if (signInId === null) {
            throw new SignInRefused();
          }
          return { ...applyUserToToken(token, user), signInId };
        }
        /*
         * On Auth.js's own routes, an ended sign-in names nobody and its
         * cookie is cleared: the session endpoint is what the phone asks to
         * learn who is signed in (sign-out's check, the queue's owner). The
         * app's own auth() calls leave this to resolveSession, so a request
         * still costs one lookup.
         */
        if (request !== undefined) {
          const userId = asUuid(token.sub);
          if (userId === null) return null;
          try {
            const checked = await checkSignIn(db, userId, token.signInId);
            if (checked.status === "no-user" || checked.status === "ended") return null;
          } catch (error) {
            /* Authorizes nothing, so an outage keeps the cookie rather than
               signing every phone that asks out; the API still answers 500. */
            base.logger.error(error instanceof Error ? error : new Error(String(error)));
          }
        }
        return base.callbacks.jwt(params);
      },
    },
    events: {
      /*
       * This sign-in only: the member's other devices stay signed in (#125).
       * Auth.js logs and swallows an error here, and clears the cookie anyway.
       */
      async signOut(message) {
        const token = "token" in message ? message.token : null;
        const userId = asUuid(token?.sub);
        if (userId !== null) {
          await endSignIn(db, userId, token?.signInId);
        }
      },
    },
  };
}
