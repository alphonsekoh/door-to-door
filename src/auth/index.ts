import NextAuth from "next-auth";
import { buildAuthConfig } from "@/server/auth/config";

/*
 * The Auth.js entrypoint. A thin wrapper by design: the configuration and the
 * role logic live in src/server/auth, where they are unit tested. Google
 * sign-in's own pieces sit beside it, in google.ts (#14).
 *
 * The config is built lazily. Passing an object here would construct the
 * Drizzle adapter at module load, which makes `next build` require a live
 * database and config.yaml - builds need neither. Auth.js passes the request
 * only to its own route handlers, which is how the config tells those apart
 * from the app's auth() calls (#125).
 *
 * Auth.js's server-side signOut is not exported: it builds the config with no
 * request, so a sign-in it failed to end could not keep the cookie (#162).
 * Signing out is the route's, through next-auth/react.
 */
export const { handlers, auth, signIn } = NextAuth((request) => buildAuthConfig(request));
