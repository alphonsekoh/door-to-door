import { AUTH_PREFIX } from "@/server/auth/routes";

const SIGN_OUT = `${AUTH_PREFIX}/signout`;

/*
 * Auth.js's own routes answer with the CSRF token and the session, so they
 * are no-store like every other API response.
 *
 * A sign-out also drops the phone's HTTP cache and bfcache. Only "cache":
 * the worker's precache and the IndexedDB queue (D-33-1), which can hold
 * another member's unsent records, fall under "storage", which is never
 * sent. It goes on a refused sign-out too, since clearing costs nothing.
 *
 * The response is copied rather than edited because a Response.redirect has
 * immutable headers.
 */
export function withAuthRouteHeaders<TRequest extends Request>(
  handler: (request: TRequest) => Promise<Response>,
): (request: TRequest) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    if (request.method === "POST" && new URL(request.url).pathname === SIGN_OUT) {
      headers.set("clear-site-data", '"cache"');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
