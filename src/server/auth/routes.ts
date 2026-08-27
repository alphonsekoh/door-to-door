/*
 * Which paths the proxy lets through unauthenticated. Kept as data so the
 * rules are testable without standing up a request.
 */

export const PUBLIC_PATHS = ["/sign-in"] as const;

/* Auth.js owns these; guarding them would make signing in impossible. */
export const AUTH_PREFIX = "/api/auth";

export function isPublicPath(pathname: string): boolean {
  if (pathname === AUTH_PREFIX || pathname.startsWith(`${AUTH_PREFIX}/`)) {
    return true;
  }
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/*
 * Where to send an unauthenticated visitor. The destination is preserved so
 * they land where they were going rather than on the home screen - a member
 * following a link to a unit should reach that unit after signing in.
 */
export function signInRedirect(pathname: string, search: string): string {
  const destination = `${pathname}${search}`;
  if (destination === "/" || destination === "") {
    return "/sign-in";
  }
  return `/sign-in?callbackUrl=${encodeURIComponent(destination)}`;
}
