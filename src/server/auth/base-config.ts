import type { NextAuthConfig } from "next-auth";
import { applyTokenToSession, applyUserToToken } from "@/server/auth/callbacks";

/*
 * Everything Auth.js needs that does not touch the database.
 *
 * Kept separate so the proxy can build an Auth.js instance without the Drizzle
 * adapter: the proxy runs on the edge runtime, where pg cannot load. Sessions
 * are JWTs, so verifying one needs no database anyway.
 */
export const baseAuthConfig = {
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
    jwt({ token, user }) {
      return applyUserToToken(token, user);
    },
    session({ session, token }) {
      return applyTokenToSession(session, token);
    },
  },
  trustHost: true,
  // Providers are supplied by each consumer: the full config adds
  // credentials, the proxy needs none to verify a JWT.
  providers: [],
} satisfies NextAuthConfig;
