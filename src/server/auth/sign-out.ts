import type { NextAuthConfig } from "next-auth";
import type { Database } from "@/db/client";
import { asUuid, endSignIn } from "@/server/auth/sign-ins";

/*
 * Signing out ends this sign-in only (#125), and never clears the phone's
 * cookie while its sign-in is still live (#162).
 *
 * Auth.js logs and swallows an error from its signOut event (as an
 * EventError), and clears the cookie anyway (R-143). A sign-in left live
 * that way is brought back by a late answer from the worker, the queue or
 * the page, which sets the old cookie again. So a failure is noted against
 * the request, and the route answers with a failure in place of Auth.js's
 * answer: the cookie stays, the phone says sign-out failed, and the member
 * can try again.
 *
 * The request is the key because Auth.js hands the config it builds the
 * route's own request (src/auth/index.ts). The event runs only after
 * Auth.js's CSRF check, so a forged sign-out ends nothing.
 */

const unended = new WeakSet<Request>();

type SignOutEvent = NonNullable<NonNullable<NextAuthConfig["events"]>["signOut"]>;

/* Auth.js's signOut event, for the sign-out `request` asked for. */
export function endThisSignIn(db: Database, request: Request): SignOutEvent {
  return async (message) => {
    const token = "token" in message ? message.token : null;
    const userId = asUuid(token?.sub);
    if (userId === null) return;
    try {
      await endSignIn(db, userId, token?.signInId);
    } catch (error) {
      unended.add(request);
      /* For Auth.js to log. */
      throw error;
    }
  };
}

/*
 * What the phone gets when its sign-in could not be ended: the shape of
 * Auth.js's own refused sign-out, an error URL, which next-auth/react's
 * signOut hands back and the client's sign-out reports as a failure
 * (src/lib/session/sign-out.ts). This answer sets no cookie, so nothing
 * clears the session's. The proxy in front may still add its own:
 * Auth.js's callback-url cookie, or the same sign-in's token re-issued by
 * its session refresh. Neither ends or changes the sign-in, which is what
 * the phone should keep.
 */
export const SIGN_OUT_FAILED_URL = "/sign-in?error=SignOutError";

export function failUnendedSignOut<TRequest extends Request>(
  handler: (request: TRequest) => Promise<Response>,
): (request: TRequest) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    if (!unended.has(request)) return response;
    return Response.json({ url: SIGN_OUT_FAILED_URL }, { status: 500 });
  };
}
