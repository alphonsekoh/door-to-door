# #121 · Refuse cross-origin writes and non-JSON bodies

- **Status:** In review (PR #139)
- **Phase:** 7 - Hardening
- **Depends on:** #12, #13, #33

## Task

The session cookie is `SameSite=Lax`, which separates sites, not origins, and
`withContract` parsed any body as JSON. So a page on a sibling subdomain could send a
CORS-simple `text/plain` POST with a member's cookie, and create an admin. Found by a
security audit; whether it is exploitable depends on the domain the app is deployed
under, which is not decided yet.

## Decisions

- **D-121-1 · `withContract` refuses a cross-origin write first, with `403 forbidden`.**
  Every method but `GET`, `HEAD` and `OPTIONS`, before path, query, body or session is
  read. _Why:_ every cookie-authenticated write already goes through it (D-12-1), so an
  operation added later is covered, and a forged request learns nothing a handler would
  tell it. The proxy stays an affordance (D-16-2), so it still answers one with no
  session `401` first; Auth.js's own routes are not wrapped and keep its CSRF token.
  D-10-4 and D-83-4 still hold for the app's own requests; another origin's gets
  `forbidden` instead.
- **D-121-2 · `Sec-Fetch-Site`, when present and not empty, decides alone.**
  `same-origin` and `none` pass; anything else, `same-site` included, is refused,
  whatever `Origin` says. _Why:_ ~~only a browser can set it~~ a page's script can
  neither set nor change it (a forbidden `Sec-` header; a client outside a browser can,
  but carries no member's cookie), and `none` is a request the user started, which no
  page can forge; checking `Origin` too would make every write depend on the proxy
  passing the public host (D-121-5). Reason corrected by the owner (2026-11-03); the
  decision stands. _Research:_ R-96.
- **D-121-3 · Without it, the `Origin`'s host and port must be this server's.** A
  `null`, unparsable or foreign `Origin` is refused, and so is any `Origin` when there is
  no host to compare it with. _Why:_ Safari before 16.4, and any page on plain `http` (a
  phone on the LAN), send no `Sec-Fetch-Site`; `null` comes from sandboxed frames and
  `file:` pages, which still carry cookies. _Trade-off:_ the scheme is not compared, so
  an `http` page on the app's own host would pass. _Research:_ R-96, R-97. _Refined by
  D-121-10:_ a default port in the server's host counts as none. _Narrowed by D-122-5:_
  once a browser has seen the app's HSTS, it no longer loads that host over `http`.
- **D-121-4 · A write with neither header passes.** _Why:_ a browser adds `Origin` to
  every write, so neither means a script, a test or a Playwright setup call, not a page
  acting with someone's cookie. _Trade-off:_ fails open for a client that sends neither.
  _Research:_ R-97.
- **D-121-5 · The `Origin` passes if it matches either the first `X-Forwarded-Host`
  entry or `Host`; no config key, not `request.url`.** ~~The server's own host is the
  first `X-Forwarded-Host` entry, else `Host`.~~ _Why:_ Next builds `request.url` from
  the bind address, so behind a proxy it names `localhost`; `auth.trustHost: true`
  already needs a right `Host`; a key would tie the app to a domain not chosen yet. A
  page cannot set `Host`, nor `X-Forwarded-Host` without a preflight the app never
  grants. Either one, because neither is the page's to choose: when a proxy sets
  `X-Forwarded-Host`, the extra name `Host` carries is the proxy's upstream host, which
  is this server too. The first entry, because a proxy appends. Wording corrected by the
  owner (2026-11-03): it said "else `Host`", but `ownHosts` in
  `src/server/http/same-origin.ts` has always accepted either; the code stands.
  _Trade-off:_ a proxy that rewrites `Host` and sets no `X-Forwarded-Host` (nginx's
  default) gets every write refused from a browser without `Sec-Fetch-Site`; README
  Deployment says how to configure it. _Research:_ R-98, R-99.
- **D-121-6 · A non-empty request body must be `application/json`, else
  `415 unsupported_media_type`.** Parameters such as `charset` pass; a missing
  `Content-Type` or a `+json` type is refused; a blank body is still reported missing
  (`400`). Checked after the origin check, before `JSON.parse`, only where the operation
  takes a body. New `ErrorCode` (D-10-2). _Why:_ `text/plain`, form and multipart are
  the bodies another origin can send without a preflight. _Research:_ R-97.
- **D-121-7 · `415`, not `400`, and neither refusal is charged to a queued record.**
  _Why:_ a lone record refused `400` is quarantined (D-33-4, D-33-6), but the record is
  not at fault. A `415` or a plain `403 forbidden` is a whole-request answer D-33-17 does
  not name, so the queue backs off (D-33-27) and the bar says "The server is busy";
  `apiFetch` raises no account screen for it (D-33-5).
- **D-121-8 · Contract: a shared `UnsupportedMediaType` response on the 17 operations
  with a request body, and the `403` that `createFollowUp` lacked.** `Forbidden` names
  the cross-origin case, and an info section "Same origin only" states the rule. _Why:_
  the spec describes every status a handler returns (D-10-1); a shared response keeps
  the `openapi.yaml` diff small while #119 edits the same file.
- **D-121-9 · The route sweep is derived from the spec.**
  `src/app/api/same-origin.test.ts` sends every non-`GET` contract operation a
  cross-site request (refused before `auth()`) and a same-origin one (let past). _Why:_
  a test of `withContract` alone does not prove every route uses it, and an operation
  added later is swept without editing the test.
- **D-121-10 · In that comparison, the `Origin`'s own scheme's default port on the
  server's host counts as no port.** `:443` for an `https` `Origin`, `:80` for `http`,
  in `Host` or the first `X-Forwarded-Host`; any other port, or the other scheme's
  default, must match exactly. Owner ruling (2026-11-03); refines D-121-3. _Why:_ a
  browser's `Origin` never names its default port, but a proxy forwarding
  `$host:$server_port` does, and every browser without `Sec-Fetch-Site` would be locked
  out. Only its own scheme's, so `:80` never stands in for an `https` page.
  _Research:_ R-100.

## Relies on

D-10-1, D-10-2, D-10-4, D-12-1, D-12-3, D-16-2, D-33-4 to D-33-6, D-33-17, D-33-19 (the
worker sends no writes), D-33-27, D-83-4.

## Open questions

None.
