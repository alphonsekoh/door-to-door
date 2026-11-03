import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextProxy, type NextRequest } from "next/server";
import { buildBaseAuthConfig } from "@/server/auth/base-config";
import { isApiPath, isPublicPath, isPwaPath, signInRedirect } from "@/server/auth/routes";
import { getConfig } from "@/server/config";

/*
 * An optimistic guard, and only that.
 *
 * Next's own documentation is explicit that proxy is not a session management
 * or authorization solution, and this follows that: it redirects visitors who
 * clearly have no session, so they are not shown a shell that cannot load.
 * Every handler still calls requireUser/requireRole, because a request can
 * reach a route without passing here.
 *
 * Built from the base config rather than the full one: verifying a JWT needs
 * no database, so the proxy never opens a pool. Next 16 runs proxy on Node, so
 * it can read config.yaml like any handler. The function form defers that read
 * until the first request, keeping `next build` free of the file (D-13-4).
 */
const { auth } = NextAuth(() => buildBaseAuthConfig(getConfig()));

const guard = auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (request.auth) {
    const response = NextResponse.next();
    /*
     * Signed-in pages are never stored or restored. Without this, Back after
     * signing out brings the old page back from the browser's own cache (or
     * bfcache) - the shell with every request failing 401 - rather than
     * asking the server, which would redirect to sign-in. no-store also keeps
     * a page out of bfcache in Chromium.
     */
    if (!isApiPath(pathname)) {
      response.headers.set("Cache-Control", "no-store");
    }
    return response;
  }

  /*
   * API callers get a 401 in the contract's envelope rather than a redirect
   * to an HTML page, which a fetch() could not do anything useful with.
   */
  if (isApiPath(pathname)) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Sign in to continue." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.redirect(new URL(signInRedirect(pathname, search), request.nextUrl));
});

/*
 * With the function form of NextAuth, auth(handler) is a promise of the
 * wrapped handler at runtime although typed as the handler itself. Next
 * rejects a default export that is not a function, so the promise is awaited
 * per request instead of exported directly.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  /*
   * The PWA files never reach auth(): its session check mints a CSRF cookie on
   * any request that arrives without one, and these are fetched cookieless.
   * WebKit stores the cookie from its worker update check anyway, so the
   * member's token was swapped mid sign-out and Auth.js refused it as
   * MissingCSRF. /sign-in still goes through: its cookie arriving with the page
   * is what stops the form's first auth requests each minting their own.
   */
  if (isPwaPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const middleware = (await Promise.resolve(guard)) as unknown as NextProxy;
  return middleware(request, event);
}

export const config = {
  /* Everything except Next's own assets and static files. */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
