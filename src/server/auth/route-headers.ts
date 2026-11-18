/*
 * Auth.js's own routes answer with the CSRF token and the session, so they
 * are no-store like every other API response.
 *
 * A sign-out sends no Clear-Site-Data (D-218-1). Chrome holds the answer back
 * until it has cleared its whole HTTP cache, seconds on a real profile, and
 * nothing signed-in is in that cache: every page and API answer is no-store.
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
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
