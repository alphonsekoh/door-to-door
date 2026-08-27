import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
import { getDatabase } from "@/db/client";
import { accounts, authSessions, users, verificationTokens } from "@/db/schema";
import { applyTokenToSession, applyUserToToken } from "@/server/auth/callbacks";

/*
 * Auth.js configuration. Providers are added by #14 (Google) and #15
 * (credentials); this file owns the adapter, the session strategy and how a
 * role reaches the app.
 */
export function buildAuthConfig(): NextAuthConfig {
  return {
    adapter: DrizzleAdapter(getDatabase(), {
      usersTable: users,
      accountsTable: accounts,
      // Named auth_sessions in our schema, because outing_sessions is the
      // domain concept and the clash would be confusing.
      sessionsTable: authSessions,
      verificationTokensTable: verificationTokens,
    }),
    session: {
      /*
       * Required, not preferred: the Credentials provider (#15) does not work
       * with database sessions. auth_sessions therefore exists to satisfy the
       * adapter's contract and is unused at runtime.
       */
      strategy: "jwt",
      maxAge: 60 * 60 * 24 * 30,
    },
    providers: [],
    pages: {
      signIn: "/sign-in",
      error: "/sign-in",
    },
    callbacks: {
      jwt({ token, user }) {
        return applyUserToToken(token, user);
      },
      session({ session, token }) {
        return applyTokenToSession(session, token);
      },
    },
    trustHost: true,
  };
}
