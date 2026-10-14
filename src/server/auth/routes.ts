/*
 * Which paths the proxy lets through unauthenticated. Kept as data so the
 * rules are testable without standing up a request.
 */

/*
 * The PWA files are public because the browser fetches them without cookies:
 * the manifest on a cold visit, and the service worker script on every update
 * check (a redirect to /sign-in there fails the registration). /offline is the
 * page the worker shows when the network is gone, so it must be precachable by
 * a worker that has no session of its own. None of them carry member data.
 */
export const PWA_PATHS = ["/offline", "/manifest.webmanifest", "/serwist"] as const;

export const PUBLIC_PATHS = ["/sign-in", ...PWA_PATHS] as const;

/* Auth.js owns these; guarding them would make signing in impossible. */
export const AUTH_PREFIX = "/api/auth";

const under = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function isPublicPath(pathname: string): boolean {
  return under(pathname, AUTH_PREFIX) || PUBLIC_PATHS.some((path) => under(pathname, path));
}

export function isPwaPath(pathname: string): boolean {
  return PWA_PATHS.some((path) => under(pathname, path));
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
