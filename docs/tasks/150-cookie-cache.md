# #150 · Responses that set cookies are never shared-cacheable

- **Status:** Done (PR #152, with #128)
- **Phase:** 7 - Hardening
- **Depends on:** #32, #74, #122

## Task

The prerendered `/sign-in` was sent with `Cache-Control: s-maxage=31536000` in the same
response that carried Auth.js's CSRF and callback-url cookies. A shared cache that
ignores `Set-Cookie` could then serve one visitor's CSRF cookie to everyone for a year.
The #122 verifier found it. This fix ships in one PR with #128.

## Decisions

- **D-150-1 · The proxy sets `Cache-Control: no-store` on every response that carries
  `Set-Cookie`, after the Auth.js wrapper has answered.** That covers `/sign-in`'s first
  visit, the signed-out `307` and `401`, `/api/auth/*`, and each API answer passed
  through with a refreshed session cookie. **Refines D-74-11 and D-122-9**, under which
  the proxy left the API answers it passed through to their handlers. Those handlers
  already send the same value. _Why:_ the wrapper copies its cookies onto a fresh
  `Response` after the guard returns, so the proxy sees every cookie only at that point.
  One rule where the cookies are written covers every path, however the page is
  rendered. No other app code sets a cookie (verifier grep). _Research:_ R-122.
- **D-150-2 · `/sign-in` is `no-store` whether or not it sets a cookie.** The guard's
  `no-store` branch now also takes public pages, and `/sign-in` is the only public page
  that reaches it. **Keeps D-32-19.** _Why:_ a return visit sets no cookie. If a shared
  cache kept that copy, a first-time visitor would get the page without the CSRF cookie
  that D-32-19 needs to arrive with it. _Research:_ R-123.
- **D-150-3 · Plain `no-store`, not the issue's `private, no-store`.** _Why:_ `no-store`
  already forbids every cache from storing the response, private caches included, so
  `private` adds nothing. It is also the value D-74-11, D-122-9 and D-122-10 send, so
  every such response carries the same header. _Research:_ R-123.
- ~~**D-150-4 · `/sign-in` stays prerendered; it is not made dynamic.** _Why:_ D-150-1 is
  needed anyway for the `307`, the `401` and API answers. Making the page dynamic would
  fix only that one page, and would render it on every request for no gain.~~
  Superseded by D-14-10 (owner, 2026-11-12): `/sign-in` renders per request, so the
  Google button is in the first paint. D-150-1 and D-150-2 still make it `no-store`.

## Evidence

The #122 E2E header check in `e2e/auth.spec.ts` now asserts `no-store` on `/sign-in`,
both on a first visit with cookies and on a return visit without them. The #128 verifier
reverted D-150-1 and D-150-2, rebuilt, and ran that check, which failed on
`s-maxage=31536000`. In every other response it checked, `Set-Cookie` came with
`no-store`.

## Known limits

- `/offline` still sends `s-maxage=31536000`. It sets no cookie, because the proxy skips
  `auth()` there (D-32-19), and it holds no member data, so it falls outside this rule.
  Whether a CDN may keep it for a year is left to #146.
- A request to `/api/auth/*` that carries no cookies gets two `authjs.csrf-token`
  cookies, one from the proxy and one from the route. This predates the PR (D-32-19). A
  browser keeps the last one, which matches the JSON token. A script that sends both back
  gets `MissingCSRF`.

## Relies on

D-16-2, D-32-19, D-74-11 (refined), D-122-1, D-122-9 (refined), D-122-10.

## Open questions

None.
