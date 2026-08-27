import type { Role } from "@/db/schema";

/*
 * Session callbacks, kept as plain functions so the role logic is testable
 * without standing up Auth.js.
 *
 * Sessions are JWTs. That is forced, not chosen: the Credentials provider
 * (#15) cannot use database sessions. Everything the app needs for
 * authorization therefore has to travel on the token.
 */

export type TokenClaims = {
  sub?: string;
  role?: Role;
  deactivated?: boolean;
  [key: string]: unknown;
};

export type AuthenticatedUser = {
  id?: string;
  role?: Role;
  deactivatedAt?: Date | string | null;
};

export const DEFAULT_ROLE: Role = "member";

/*
 * Runs with `user` present only on sign-in; afterwards the token is passed
 * through. New accounts default to member - never admin - so an SSO sign-up
 * cannot grant itself privileges.
 */
export function applyUserToToken(token: TokenClaims, user?: AuthenticatedUser): TokenClaims {
  if (!user) {
    return token;
  }
  return {
    ...token,
    ...(user.id === undefined ? {} : { sub: user.id }),
    role: user.role ?? DEFAULT_ROLE,
    deactivated: user.deactivatedAt != null,
  };
}

/*
 * Deliberately not intersected with Record<string, unknown>: Auth.js session
 * types are interfaces, which have no implicit index signature and so would
 * not be assignable.
 */
export type SessionShape = {
  user?: { id?: string; role?: Role; deactivated?: boolean } | undefined;
};

/* Surfaces the token's claims on the session the app reads. */
export function applyTokenToSession<T extends SessionShape>(session: T, token: TokenClaims): T {
  if (!session.user) {
    return session;
  }
  return {
    ...session,
    user: {
      ...session.user,
      ...(token.sub === undefined ? {} : { id: token.sub }),
      role: token.role ?? DEFAULT_ROLE,
      deactivated: token.deactivated ?? false,
    },
  };
}
