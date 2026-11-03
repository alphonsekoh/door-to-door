# #122 · Security headers, no-store API answers, always-Secure cookies

- **Status:** In progress (branch `fix/122-security-headers`, not pushed)
- **Phase:** 7 - Hardening
- **Depends on:** #12, #13, #32, #74, #75, #121

## Task

The app sent almost no response headers. It had no CSP, no HSTS and no framing or
sniffing rules, `X-Powered-By` was on, and API answers, which name households and
members, carried no `Cache-Control`. The session cookie was `Secure` only if the TLS
proxy sent `X-Forwarded-Proto: https`. The 2026-10-28 security audit (#133) found these.
This PR adds the headers with the CSP in Report-Only mode, makes every API answer
`no-store`, and makes the cookies `Secure` through config. Enforcing the CSP and adding
HSTS `includeSubDomains` wait for the first deployment (#146).

## Decisions

### Headers

- **D-122-1 · The security headers are one build-time list.** It lives in
  `src/server/http/security-headers.ts`, `next.config.ts` `headers()` applies it to
  `/(.*)`, and `poweredByHeader` is `false`. None of it is a config key. _Why:_
  `next build` evaluates `headers()` without a config file (D-13-4, D-75-9, D-106-4).
  One list reaches every response, including those the proxy writes and the PWA paths
  it skips (D-32-19). `NODE_ENV` in `next.config.ts` is the build mode, which D-75-7
  allows.
  `e2e/auth.spec.ts` checks the full set on pages, the PWA paths, a static file, the
  proxy's `401` and `307`, and answers from Auth.js and `withContract`. _Research:_ R-119.
- **D-122-2 · The CSP directives.** `default-src 'self'`; `'unsafe-inline'` for scripts
  and styles; `img-src 'self' data:`; `connect-src` and `worker-src 'self'`;
  `object-src 'none'`; `base-uri` and `form-action 'self'`; `frame-ancestors 'none'`.
  `'unsafe-eval'` is added only under `next dev`. _Why:_ nonces would need every page
  rendered per request, but `/offline` is prerendered and precached by the worker
  (D-32-4, D-77-7). Next's inline RSC scripts and React's `style` attributes need
  `'unsafe-inline'`. `data:` is the noise texture. _Trade-off:_ once the policy is
  enforced, an injected inline script still runs, but it cannot reach another origin,
  load a plugin, change `<base>` or send a form off-site.
- **D-122-3 · Report-Only, with no report endpoint and no `upgrade-insecure-requests`.**
  _Why:_ the issue asks for Report-Only first. A report endpoint would be an
  unauthenticated write that D-121-6 refuses. The E2E watcher (D-122-8) provides the
  evidence instead. `upgrade-insecure-requests` is ignored in a Report-Only policy and
  would break plain-http runs once the policy is enforced, and HSTS covers it anyway.
  WebKit logs on every page that a report-only policy without `report-to` "will have no
  effect". That is expected until #146, and WebKit still fires violation events.
  _Research:_ R-115, R-117.
- **D-122-4 · `X-Frame-Options: DENY` as well.** _Why:_ a Report-Only `frame-ancestors`
  blocks nothing. _Research:_ R-117.
- **D-122-5 · HSTS is `max-age=63072000`, without `includeSubDomains` or `preload`
  (owner, 2026-11-03).** This is the answer to Q1. It is revisited in #146, once the
  domain is known to serve only this app. _Why:_ if the apex domain is shared with
  http-only services, `includeSubDomains` would force https on every sibling subdomain
  for two years, and that cannot be recalled. On a host only this app uses, it adds
  little, because the cookies already carry the `__Secure-` and `__Host-` prefixes.
  Browsers ignore HSTS over http, so E2E and local runs are unaffected. Once a browser
  has seen the header, it also narrows D-121-3's trade-off. _Research:_ R-118.
- **D-122-6 · `nosniff`, `Referrer-Policy: same-origin` and
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,** as the issue
  proposes. _Why:_ the app uses none of those features and links nowhere off-site.
- **D-122-7 · Client zod runs jitless, set in `src/instrumentation-client.ts`.** It uses
  the named `import { config } from "zod"`, where the plan said `z.config`. The server
  keeps the JIT. _Why:_ zod probes `new Function("")` once per page, when the first
  object schema is built. Chromium reports that probe under this policy now, and both
  engines will once it is enforced. Next runs this file before hydration, so before any
  client schema exists. _Reason corrected:_ the plan said every engine reports the
  probe, Report-Only or enforced. WebKit does not report it under Report-Only, so the
  WebKit half of the clean Report-Only E2E run says nothing about eval. Only the
  verifier's enforced trial does. _Research:_ R-114, R-115.
- **D-122-8 · Every E2E page fixture fails its test on any CSP violation, with nothing
  filtered.** _Why:_ a Report-Only policy never fails anything by itself, so a clean
  suite is what justifies enforcing it (#146). _Limits:_ the watcher sees violations in
  the page only. The worker's policy comes from the `/serwist/sw.js` response and
  reports in the worker's own scope, so the #146 checklist keeps an enforced E2E trial
  to cover the worker. On WebKit it also misses eval under Report-Only (D-122-7).
  _Research:_ R-115, R-117.

### Caching

- **D-122-9 · Every `withContract` answer is `Cache-Control: no-store`, set in
  `jsonResponse`, refusals and 500s included. The proxy sets it on the 401 it writes
  too. Refines D-74-11:** the proxy still leaves API answers it passes through to their
  handlers. _Why:_ under D-12-1, every handler's answer goes through `jsonResponse`.
  See Known limits for the bodiless answers Next writes itself. _Research:_ R-119.
- **D-122-10 · Auth.js's route is wrapped in `withAuthRouteHeaders`.** Every
  `/api/auth/*` answer is `no-store`. A `POST` to exactly `/api/auth/signout` (not a
  sub-path) also gets `Clear-Site-Data: "cache"`, never `storage`, `cookies` or `*`.
  _Why:_ the CSRF and session answers are API answers too. `"cache"` drops the HTTP
  cache, and bfcache where the engine does so. Cache Storage holds the precache
  (D-32-4) and the block cache, which D-74-9 still clears itself. IndexedDB holds the
  queue (D-33-1). Both fall under `"storage"`, which is never sent. _Trade-off:_ the
  header is also sent on a refused sign-out, so a cross-site form POST can make a
  browser drop this origin's HTTP cache and bfcache. That is harmless, because nothing
  the app needs offline lives there. Keeps D-74-9, D-74-10, D-83-12 (the wrapper does
  not import `@/auth`) and D-121-1 (Auth.js's routes get no same-origin check). The
  route test runs real Auth.js with only the config mocked. This does not close #129.
  _Research:_ R-116.
- **D-122-11 · `no-store` leaves D-32-3 unchanged.** _Why:_ `Cache-Control` does not
  govern the worker's Cache Storage copy of `GET /api/blocks`. The pwa.spec test of the
  cached block list still passes.

### Cookies and contract

- **D-122-12 · `auth.secureCookies` (boolean, default `true`) is passed as
  `useSecureCookies` in `buildBaseAuthConfig`.** The route handlers and the proxy
  therefore agree on `__Secure-authjs.session-token` and `__Host-authjs.csrf-token`
  whatever scheme they see. Only the config Playwright writes and `config.docker.yaml`
  set it `false`. It never comes from env (D-75-2, D-75-7). _Why:_ without it, Auth.js
  takes the flags from the scheme, which is http behind a TLS proxy that sends no
  `X-Forwarded-Proto`. The two halves then disagree: when no `X-Forwarded-Proto`
  arrives, the proxy's session lookup assumes https, while the route handlers use the
  request's scheme. They could look for different cookie names (builder finding). The
  `false` in `config.docker.yaml` affects Compose only (`next dev` over plain http). A
  production image reads the operator's `config.yaml` and gets `true`.
  `src/server/auth/config.test.ts` asserts that the value is passed. _Trade-off:_ over
  plain http, Safari and phones on the LAN drop the `Secure` CSRF cookie, so sign-in
  says "Email or password is incorrect." (`MissingCSRF` in the log). The README says to
  set the key `false` there. _Research:_ R-113.
- **D-122-13 · The contract names the cookie `__Secure-authjs.session-token`, and a new
  `info` section, Caching, states the no-store rule.** _Why:_ D-10-1. `withContract`
  does not validate headers, and D-121-8 set the precedent of stating cross-cutting
  rules in `info`. Nothing in `src/generated` changes. The section's "every response"
  overstates slightly: Known limits lists the exceptions. _Research:_ R-119.
- **D-122-14 · The CSP is enforced in a follow-up after the first deployment on the
  chosen domain, once a real-device pass shows no violations (owner, 2026-11-03).**
  This is the answer to Q2, tracked in #146. The pass covers iOS Safari, installed and
  in a tab, and Android Chrome: sign in, record online and offline, cold offline launch,
  sign out. The switch is the `CSP_HEADER` constant. _Why:_ Playwright cannot show the
  two things most likely to break an enforced policy: a CDN or proxy that injects
  scripts, and real-device engines. Nothing is deployed yet, so Report-Only costs
  nothing until then. The verifier's local enforced trial was clean on both engines.

## Known limits

- **Some answers Next writes itself miss headers.** Its trailing-slash `308` (for
  example `/history/` or `POST /api/auth/signout/`) carries none of the set. Its
  automatic `OPTIONS` `204` and `405` (for example `PUT /api/blocks`) carry the security
  headers but no `no-store`, and neither does the `500` it renders in dev and test when
  a `ResponseContractError` is rethrown. None of these has a body or any member data, so
  they are accepted with no code change. _Research:_ R-119.
- **The browsers hide some headers the server sends.** Chromium drops
  `Strict-Transport-Security` from responses served from its HTTP cache or a worker
  cache. WebKit hides most of a redirect's headers from Playwright. curl shows the
  server sends them all.
- **Not yet tested on a real phone over https.** The Secure-cookie path has run only in
  Chromium, over loopback http. The first https deployment (#146) still needs checks on
  a real iPhone and Android phone: sign-in, sign-out (the `__Host-` CSRF cookie), Back
  after sign-out, the WebKit worker update check (D-32-19), HSTS, and that
  `Clear-Site-Data` spares the queue and the offline shell.

## Relies on

D-10-1, D-12-1, D-13-4, D-16-2, D-32-3, D-32-4, D-32-19, D-33-1, D-74-9, D-74-10,
D-74-11 (refined), D-75-2, D-75-7, D-75-9, D-77-7, D-83-12, D-106-4, D-121-1, D-121-6,
D-121-8.

## Open questions

- **Prerendered `/sign-in` is sent with `Cache-Control: s-maxage=31536000` and the
  proxy's CSRF and callback-url `Set-Cookie`.** A shared cache that ignores `Set-Cookie`
  could give one CSRF cookie to everyone. This PR did not cause it; the verifier found
  it. Owner: should it get its own issue, or go into #146 once the CDN is chosen?
