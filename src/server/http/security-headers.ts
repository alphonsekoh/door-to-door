/*
 * The headers every response carries, pages, API, static files and the PWA's
 * alike. One build-time list rather than config keys: next.config.ts applies
 * it in headers(), which `next build` evaluates with no config file (D-13-4).
 */

export type ResponseHeader = { key: string; value: string };

/*
 * Report-Only until a real-device pass on the deployed domain shows no
 * violations (#146). Enforcing it is this one name.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/*
 * 'unsafe-inline' because nonces need every page rendered per request, and the
 * prerendered /offline the worker precaches is not; Next's inline RSC scripts
 * and React's style attributes need it. data: is the noise texture in
 * globals.css. No upgrade-insecure-requests: it would break plain-http runs
 * once enforced, and HSTS covers it.
 */
function contentSecurityPolicy(development: boolean): string {
  /* next dev evaluates its hot-reload modules; a production build does not. */
  const scripts = development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders({ development }: { development: boolean }): ResponseHeader[] {
  return [
    { key: CSP_HEADER, value: contentSecurityPolicy(development) },
    /* No includeSubDomains until the domain is known to be this app's alone (#146). */
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    /* frame-ancestors is not enforced while the policy only reports. */
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
