import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { baseAuthConfig } from "@/server/auth/base-config";
import { isApiPath, isPublicPath, signInRedirect } from "@/server/auth/routes";

/*
 * An optimistic guard, and only that.
 *
 * Next's own documentation is explicit that proxy is not a session management
 * or authorization solution, and this follows that: it redirects visitors who
 * clearly have no session, so they are not shown a shell that cannot load.
 * Every handler still calls requireUser/requireRole, because a request can
 * reach a route without passing here.
 *
 * Built from baseAuthConfig rather than the full config: the edge runtime
 * cannot load pg, and verifying a JWT needs no database.
 */
const { auth } = NextAuth(baseAuthConfig);

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (request.auth) {
    return NextResponse.next();
  }

  /*
   * API callers get a 401 in the contract's envelope rather than a redirect
   * to an HTML page, which a fetch() could not do anything useful with.
   */
  if (isApiPath(pathname)) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Sign in to continue." } },
      { status: 401 },
    );
  }

  return NextResponse.redirect(new URL(signInRedirect(pathname, search), request.nextUrl));
});

export const config = {
  /* Everything except Next's own assets and static files. */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
