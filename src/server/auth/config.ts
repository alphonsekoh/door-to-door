import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDatabase } from "@/db/client";
import { accounts, authSessions, users, verificationTokens } from "@/db/schema";
import { buildBaseAuthConfig } from "@/server/auth/base-config";
import { authorizeFromRawCredentials } from "@/server/auth/credentials";
import { getConfig } from "@/server/config";

/*
 * Auth.js configuration. Providers are added by #14 (Google) and #15
 * (credentials); this file owns the adapter, the session strategy and how a
 * role reaches the app.
 */
export function buildAuthConfig(): NextAuthConfig {
  return {
    ...buildBaseAuthConfig(getConfig()),
    adapter: DrizzleAdapter(getDatabase(), {
      usersTable: users,
      accountsTable: accounts,
      // Named auth_sessions in our schema, because outing_sessions is the
      // domain concept and the clash would be confusing.
      sessionsTable: authSessions,
      verificationTokensTable: verificationTokens,
    }),
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
    ],
  };
}
