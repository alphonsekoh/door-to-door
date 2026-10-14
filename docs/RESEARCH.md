# Research

What was looked into before deciding, what was found, and where it led. Add an entry
whenever a decision depends on something outside this repo — a library's behaviour, a
platform limit, a doc page. Newest last.

Each entry: **question**, **finding**, **source**, **used by** (task decision IDs).

---

### R-1 · Which service-worker library for a Next.js PWA

- **Finding:** `next-pwa` is unmaintained. Serwist (`@serwist/next`) is its maintained
  successor and the option the Next.js PWA guide points to.
- **Source:** [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- **Used by:** D-32-1 (superseded by D-32-2)

### R-2 · Can Auth.js Credentials use database sessions?

- **Finding:** No. The Credentials provider only works with the JWT strategy. The
  Drizzle adapter still requires a sessions table even though it goes unused.
- **Source:** [Auth.js Credentials](https://authjs.dev/getting-started/authentication/credentials),
  [Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle)
- **Used by:** D-13-1, D-10-4, D-16-3

### R-3 · Where the role should live for role-based access in Auth.js

- **Finding:** Put it on the token in the `jwt` callback and surface it in `session`.
- **Source:** [Auth.js RBAC guide](https://authjs.dev/guides/role-based-access-control)
- **Used by:** D-13-2

### R-4 · Is `proxy.ts` (formerly middleware) an authorization layer?

- **Finding:** Next 16 renamed `middleware` to `proxy`. Its docs say it should not be
  used as a full session-management or authorization solution. It runs on the edge
  runtime, which cannot load `pg`.
- **Source:** `node_modules/next/dist/docs/` (bundled with Next 16)
- **Used by:** D-16-1, D-16-2

### R-5 · Does the hey-api generated client fit our compiler settings?

- **Finding:** Types and Zod (v4) generate cleanly. The SDK/client runtime fails
  `exactOptionalPropertyTypes` with 12 errors. The Zod plugin also drops
  `minProperties`.
- **Source:** [Hey API Zod plugin](https://heyapi.dev/docs/openapi/typescript/plugins/zod/v4);
  local typecheck of the generated output (#11)
- **Used by:** D-11-1, D-19-2

### R-6 · Zod's handling of unknown keys

- **Finding:** Object schemas strip unknown keys rather than rejecting them, so
  parsing alone does not detect a response with an extra field.
- **Source:** Probed in `withContract` tests (#12)
- **Used by:** D-12-2

### R-7 · Drizzle behaviour that types do not show

- **Finding:**
  - Driver errors are wrapped; constraint names are only on the `cause` chain.
  - A JS array inside `` sql`ANY(${arr})` `` expands to separate parameters; use `inArray`.
  - Raw `sql` aggregates have no column mapper; timestamps come back as strings
    unless `.mapWith(column)`.
  - Columns interpolated into raw `sql` render **unqualified** (`"id"`), so a
    correlated subquery silently compares against the wrong table.
  - `references()` callbacks are lazy.
- **Source:** Integration tests in #17, #27, #31; schema tests in #7
- **Used by:** D-17-3, D-27-2, D-31-3

### R-8 · Postgres NULL ordering

- **Finding:** `NULL`s sort last in `ASC`. Ordering by `done_at` puts outstanding
  notes after resolved ones unless `NULLS FIRST`.
- **Source:** Follow-ups integration tests (#22)
- **Used by:** D-22-1

### R-9 · Password hashing package

- **Finding:** `@node-rs/argon2` ships prebuilt binaries, so the Docker image needs no
  native toolchain. argon2 salts each call, so seed re-runs must not rewrite hashes.
- **Source:** Package docs; seed idempotency check (#9)
- **Used by:** D-09-2, D-09-3

### R-10 · Timing as an account-enumeration oracle

- **Finding:** An unknown email returned in ~0.6ms vs ~10ms for a real one. Verifying
  against a decoy hash evens it out (ratio ≈ 1).
- **Source:** Measured in `credentials` tests (#15)
- **Used by:** D-15-2

### R-11 · File watching in bind-mounted Docker on macOS/Windows

- **Finding:** inotify events are not delivered through bind mounts; the dev server
  must poll.
- **Source:** Observed in #5
- **Used by:** D-05-2

### R-12 · `next start` with `output: "standalone"`

- **Finding:** `next start` warns and serves a shell without the client bundle. The
  standalone build must be run with `node .next/standalone/server.js` after copying
  `public/` and `.next/static/`.
- **Source:** Observed while building the E2E suite (#37)
- **Used by:** D-37-1

### R-13 · Router prefetch while signed out

- **Finding:** In production builds, `Link` prefetches from a signed-out page receive
  the proxy's redirect to `/sign-in`, which the client router caches and replays after
  sign-in. Dev mode does not reproduce it.
- **Source:** E2E first run (#37)
- **Used by:** D-37-3

### R-14 · Playwright device profiles

- **Finding:** iPhone profiles require WebKit; Pixel 5 runs on Chromium. Safari
  behaviour is therefore not covered by the suite.
- **Source:** Playwright device registry
- **Used by:** D-37-2 (superseded by D-32-18)

### R-15 · iOS input zoom and WCAG zoom

- **Finding:** iOS zooms on focus when input text is under 16px. Capping
  `maximumScale` at 1 fails WCAG 1.4.4.
- **Source:** WCAG 1.4.4; iOS Safari behaviour
- **Used by:** D-01-1

### R-16 · Next.js PWA guide: install prompt

- **Finding:** The guide's custom install prompt is not cross-browser, and iOS has no
  `beforeinstallprompt`, so iOS needs manual instructions. It also notes
  `experimental.useOffline`; it exists and was not adopted (the issue asks for Serwist).
- **Source:** [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- **Used by:** D-32-2, D-32-9

### R-17 · `@serwist/next` vs `@serwist/turbopack`

- **Finding:** `@serwist/next` is a webpack plugin and does not run under Turbopack,
  the Next 16 default. `@serwist/turbopack` builds the worker from a route handler
  (`/serwist/[path]`). A standalone spike confirmed it builds and serves under
  `output: "standalone"`.
- **Source:** Serwist docs; spike during #32
- **Used by:** D-32-2

### R-18 · Serwist strategy status filter

- **Finding:** A Serwist `Strategy`'s default "cache only 200/opaque" status filter is
  dropped when a plugin defines `cacheWillUpdate`. Our first plugin therefore cached a
  `401`. The plugin must check `response.status === 200` itself.
- **Source:** Observed bug in #32
- **Used by:** D-32-3

### R-19 · `ExpirationPlugin` uses IndexedDB

- **Finding:** Serwist/Workbox `ExpirationPlugin` keeps its metadata in IndexedDB,
  which the offline queue (#33) owns. Also: iOS may evict IndexedDB after about 7 days
  of non-use (unverified), and iOS has no Background Sync API. Relevant to #33.
- **Source:** Workbox source; WebKit storage policy (unverified)
- **Used by:** D-32-5, D-32-6, #33 notes

### R-20 · iOS third-party browsers and Home Screen

- **Finding:** From iOS 16.4, third-party browsers can Add to Home Screen. The menu
  wording per browser (Chrome, Firefox, Edge) is unverified. Samsung Internet firing
  `beforeinstallprompt`, and the Android Firefox menu wording, are also unverified.
- **Source:** Apple iOS 16.4 release notes; unverified per browser
- **Used by:** D-32-9

### R-21 · iPad desktop-mode user agents

- **Finding:** iPad desktop-mode Safari reports a Mac UA; the CriOS and FxiOS variants
  in `install-environment.test.ts` are modelled, not captured from devices
  (unverified). They pin only the conservative outcome ("open in Safari").
- **Source:** Modelled in #32
- **Used by:** D-32-9

### R-22 · Playwright WebKit offline emulation

- **Finding:** `context.setOffline(true)` in WebKit bypasses the service worker, so the
  offline-fallback navigation cannot be tested there.
- **Source:** Observed in #32
- **Used by:** D-32-18

### R-23 · Lighthouse 12 and the PWA category

- **Finding:** Lighthouse 12 removed the PWA category, so "PWA audit passes" can no
  longer be run as written.
- **Source:** Lighthouse 12 release notes
- **Used by:** D-32-16

### R-24 · Next 16 proxy runs on Node

- **Finding:** The Next 16 `proxy` file convention runs on the Node runtime, so it can read
  the config file from disk.
- **Source:** `node_modules/next/dist/docs/` (proxy.md)
- **Used by:** D-75-12

### R-25 · Auth.js function config returns an async handler

- **Finding:** With the lazy `NextAuth(fn)` form, `auth(handler)` returns a Promise at
  runtime, so the proxy export must be async.
- **Source:** Observed in #75 (standalone run)
- **Used by:** D-75-11

### R-26 · pg-connection-string query-string overrides

- **Finding:** `pg-connection-string` lets query-string `user`, `password` and `ssl*`
  params override the URL's userinfo, so credentials can hide there.
- **Source:** pg-connection-string behaviour, checked in #75
- **Used by:** D-75-3

### R-27 · Turbopack traces `path.resolve`

- **Finding:** `path.resolve` with a dynamic argument makes Turbopack trace the whole
  directory (all of `src/server`) into the standalone output.
- **Source:** Observed in #75
- **Used by:** D-75-14

### R-28 · Next copies `.env` into `.next/standalone`

- **Finding:** `next build` copies a local `.env` into `.next/standalone`.
- **Source:** Observed in #75
- **Used by:** D-75-16

### R-29 · Unicode categories for non-printing characters

- **Finding:** `\p{Cf}` (format) covers zero-width space/joiner/non-joiner and the bidi
  overrides and isolates; `\p{Cc}` covers controls. A ZWJ emoji sequence contains
  U+200D, which is `Cf`, so it is refused with them. (Unverified against the Unicode
  tables; behaviour is covered by `own-name.test.ts`.)
- **Source:** Unicode general categories, as implemented by JS `\p{...}` with the `u` flag
- **Used by:** D-74-4

### R-30 · Auth.js absolutises the sign-out redirect from the request host

- **Finding:** `signOut()` with a redirect returns a URL built server-side from the
  request host; behind the standalone server with `HOSTNAME=127.0.0.1` this changed the
  origin to `localhost`. Observed in #74 (unverified in Auth.js source).
- **Source:** Observed in #74 e2e
- **Used by:** D-74-10

### R-31 · bfcache and `Cache-Control: no-store`

- **Finding:** Chromium does not put a `Cache-Control: no-store` page in bfcache, and the
  HTTP cache will not reuse it, so Back refetches. Other engines may differ. (Unverified
  beyond the Chromium behaviour observed in #74.)
- **Source:** Browser behaviour (web.dev bfcache guidance); observed in #74
- **Used by:** D-74-11

### R-32 · Auth.js JWT sessions are stateless

- **Finding:** With the JWT strategy there is no server-side session record, so a token
  stays valid until it expires and cannot be revoked; claims in it reflect sign-in time.
  Sign-out only clears the cookie. Anything that must change sooner has to be read from
  the database per request.
- **Source:** [Auth.js session strategies](https://authjs.dev/concepts/session-strategies); observed in #83
- **Used by:** D-83-1, D-83-15

### R-33 · `next build` prerenders pages that do not call `auth()`

- **Finding:** A page that reads nothing dynamic is prerendered at build time, so a
  database call placed before `auth()` runs during `next build`. Calling `auth()` first
  (it reads request headers) makes the page dynamic. Observed in #83.
- **Source:** Observed in #83 build
- **Used by:** D-83-8

### R-34 · `INSERT ... ON CONFLICT DO NOTHING` and row locks

- **Finding:** `ON CONFLICT DO NOTHING ... RETURNING` returns a row only for rows it
  actually inserted, so "a row came back" is a reliable "this call created it". It does
  not block on a conflicting row that is merely locked (for example by `FOR UPDATE`), only
  on an uncommitted conflicting insert. `xmax = 0` is NOT a guaranteed way to tell insert
  from update, so it is not used. Verified by test for the returned-row behaviour
  (`sync-races.integration.test.ts`); the `xmax` and lock-only points are from the
  PostgreSQL docs and unverified here.
- **Source:** [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html); #74
- **Used by:** D-74-31

### R-35 · `FOR UPDATE` re-reads committed state; a subquery keeps the statement snapshot

- **Finding:** Under READ COMMITTED, a statement that waits for a row lock (`FOR UPDATE`)
  re-reads the locked row's committed version; a separate later statement takes a fresh
  snapshot. A subquery inside one statement, however, uses that statement's snapshot, so
  an `IN (select ...)` over team membership does not see a removal committed during the
  lock wait. Verified by test (the "teammate was removed while it waited" case holds a
  real row lock from a second connection); the general rules are from the PostgreSQL
  docs.
- **Source:** [PostgreSQL concurrency control, Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html); #74
- **Used by:** D-74-31, D-74-23

### R-36 · A fetch `TypeError` cannot tell "not sent" from "reply lost"

- **Finding:** `fetch` rejects with a `TypeError` for any network-level failure, including
  when the request reached the server and only the response was lost. The client cannot
  tell whether a change was applied. Not tested here; from the Fetch specification.
- **Source:** [Fetch Standard, network error](https://fetch.spec.whatwg.org/#concept-network-error); #74
- **Used by:** D-74-43

### R-37 · The on-screen keyboard shrinks the viewport (observed, unverified)

- **Finding:** On a phone the on-screen keyboard reduces the visible area, so a sticky
  button can sit over a focused field. The E2E emulates it by shrinking the viewport; this
  is not a real keyboard, and real-device behaviour differs by browser and is unverified.
- **Source:** observed during #74 PR 3 (`e2e/teams.spec.ts`)
- **Used by:** D-74-47

### R-38 · pg rejects queries on a dead connection, and pg-pool only listens on idle clients

- **Finding:** (1) When a connected client's socket dies, `pg` schedules every queued and
  active query to reject (`_errorAllQueries`, via `process.nextTick`) and then emits
  `error` on the client. The rejection is scheduled first, so it happens even if the emit
  throws because nothing listens. (2) `pg-pool` attaches its idle listener inside the
  `connect` callback, removes it when a client is checked out and re-adds it on release.
  So an error on a checked-out client reaches only listeners on the client itself. The
  idle listener removes the client from the pool and re-emits on the pool. (3) The pool
  emits `connect` only for a newly connected client (`isNew`), not on reuse. (4) An error
  while connecting goes to the connect callback, so it rejects the connect or query
  rather than emitting `error` on the pool. Read in `node_modules` (pg 8.23.0, pg-pool
  3.14.0) and exercised by `src/db/pool-errors.integration.test.ts`.
- **Source:** `node_modules/pg/lib/client.js` lines 133-137 (`_errorAllQueries`),
  202-222 (socket `end`), 402-423 (`_handleErrorWhileConnecting`, `_handleErrorEvent`);
  `node_modules/pg-pool/index.js` lines 51-63 (`makeIdleListener`), 266-283 (connect
  callback), 335-344 (`_acquireClient`), 384-385 (`_release`); #87
- **Used by:** D-87-1, D-87-2
