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
- **Used by:** D-12-2, D-131-1

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
- **Used by:** D-17-3, D-27-2, D-31-3, D-117-7, D-126-1

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
- **Used by:** D-37-1, D-38-10

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
- **Used by:** D-32-5, D-32-6, D-33-19

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
  offline-fallback navigation cannot be tested there. _Extended by R-165 (#166):_ a
  request failed by `context.route` is failed before the worker too.
- **Source:** Observed in #32
- **Used by:** D-32-18, D-166-5

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

- **Finding:** `next build` copies a local `.env` into `.next/standalone`. Since #106 the
  build deletes it (R-54).
- **Source:** Observed in #75
- **Used by:** D-75-16, D-38-5

### R-29 · Unicode categories for non-printing characters

- **Finding:** `\p{Cf}` (format) covers zero-width space/joiner/non-joiner and the bidi
  overrides and isolates; `\p{Cc}` covers controls. A ZWJ emoji sequence contains
  U+200D, which is `Cf`, so it is refused with them. (Unverified against the Unicode
  tables; behaviour is covered by `own-name.test.ts`.)
- **Source:** Unicode general categories, as implemented by JS `\p{...}` with the `u` flag
- **Used by:** D-74-4, D-129-9

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

  _Updated (#129):_ still unverified on WebKit. Playwright's Chromium runs with bfcache
  off and its WebKit never restored a page, so neither shows a restore under WebKit over
  HTTPS; that is the owner's iPhone check. Details in R-136.

- **Source:** Browser behaviour (web.dev bfcache guidance); observed in #74
- **Used by:** D-74-11, D-129-1

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
- **Used by:** D-74-31, D-74-23, D-117-9, D-123-1, D-132-2

### R-36 · A fetch `TypeError` cannot tell "not sent" from "reply lost"

- **Finding:** `fetch` rejects with a `TypeError` for any network-level failure, including
  when the request reached the server and only the response was lost. The client cannot
  tell whether a change was applied. Not tested here; from the Fetch specification.
- **Source:** [Fetch Standard, network error](https://fetch.spec.whatwg.org/#concept-network-error); #74
- **Used by:** D-74-43, D-33-5, D-194-2

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

### R-39 · iOS WebKit ignores `min-height` on a native `<select>` (observed, unverified)

- **Finding:** A `<select>` styled `min-h-12` rendered 26px tall in Playwright's WebKit at a
  phone viewport; adding `height` (`h-12`) rendered it 48px. Chromium honoured
  `min-height`. Observed in Playwright WebKit only; unverified on a real iPhone.
- **Source:** observed during #74 PR 4 (`e2e/pwa.spec.ts`, "admin filters are at least
  44px tall", named "admin filter selects are at least 44px tall" until #245)
- **Used by:** D-74-62

### R-40 · Linux WebKit's worker update check is cookieless, but it stores cookies set on the reply

- **Finding:** Playwright's Linux WebKit (1.62.1 image) fetches `/serwist/sw.js` for its
  update check without cookies and stores any `Set-Cookie` on the response. next-auth's
  `auth()` wrapper mints a new CSRF cookie for a request that has none, so the member's
  token was replaced shortly after each navigation: CI trace showed `GET /api/auth/csrf`
  return one token and the `POST /api/auth/signout` 50ms later carry another. macOS WebKit
  sends cookies on that fetch and never reproduced it. Observed through a logging reverse
  proxy; `src/proxy-cookies.test.ts` covers the server half through the real wrapper.
- **Source:** observed in PR #93 (CI run 38529456993, `e2e/pwa.spec.ts:185`, mobile-webkit);
  next-auth 5.0.0-beta.32, @auth/core 0.41.3
- **Used by:** D-32-19, D-151-1, D-151-8

### R-41 · Auth.js reports a refused sign-out as 200 with an error URL

- **Finding:** `signOut({ redirect: false })` on a CSRF mismatch resolves with
  `{ url: ".../sign-in?error=MissingCSRF" }` and HTTP 200; the session cookie is not
  cleared. The only signal is the `error` query parameter. Observed in PR #93.
- **Source:** observed in PR #93 (server log `[auth][error] MissingCSRF`); @auth/core 0.41.3
- **Used by:** D-74-64

### R-42 · jsdom does not implement `inert`

- **Finding:** jsdom 30 has no `inert` behaviour: an inert subtree still takes focus and
  clicks in Vitest. Component tests can assert the attribute, not its effect; blocking
  taps and focus under the account screen has to be checked in a real browser.
- **Source:** jsdom 30.0.1 source (`lib/jsdom/living` has no `inert` handling); PR #98
- **Used by:** D-85-5, D-85-11

### R-43 · jsdom keeps focus on a disabled button

- **Finding:** in jsdom, disabling the focused button leaves it as `activeElement`, and
  `blur()` on a disabled button does nothing, unlike a browser, which drops focus. A test
  that only calls `blur()` passes without a refocus fix; it must move focus elsewhere.
  _Superseded by R-199 (#208):_ true of jsdom 30.0.1 only. jsdom 31 moves focus off a
  disabled control at its next rendering update.
- **Source:** observed in PR #98 (`auth-failure-screen.test.tsx`); jsdom 30.0.1
- **Used by:** D-85-15

### R-44 · Auth.js refetches the session on focus, and a failed fetch reads as signed out

- **Finding:** `SessionProvider` refetches `/api/auth/session` on every
  `visibilitychange` to visible (`refetchOnWindowFocus` defaults to true). Offline the
  fetch fails and the client resolves the session to `null`, so the page reads as
  signed out until the next successful fetch.
- **Source:** `next-auth` 5.0.0-beta.32, `react.js` and `lib/client.js`; observed in PR #99
- **Used by:** D-33-1

### R-45 · Web Locks are origin-wide; not every browser has them

- **Finding:** `navigator.locks.request(name, fn)` holds a named lock across every tab
  and worker of the origin until `fn` settles. Browsers without the API need a
  fallback. `BroadcastChannel` reaches the origin's other tabs.
- **Source:** [MDN, Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API);
  [MDN, BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- **Used by:** D-33-7

### R-46 · `navigator.storage.persist()` is a request, often refused

- **Finding:** `persist()` asks the browser to exempt the origin's storage from
  eviction; the browser may say no, and Safari on iOS mostly does (unverified). The
  answer changes nothing the app does, so it is asked once and ignored.
- **Source:** [MDN, StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist); iOS behaviour unverified
- **Used by:** D-33-19

### R-47 · Playwright fires no `online` for a document loaded offline

- **Finding:** after `context.setOffline(true)` and a reload, `navigator.onLine` stays
  true in the page, and `setOffline(false)` dispatches no `online` event to it. A phone
  does fire one. Tests that depend on `online` must dispatch it themselves. _Amended by
  R-164 (#166):_ true of Playwright 1.62 only; 1.64 reads `navigator.onLine` false there
  and fires one `online`, as a phone does.
- **Source:** observed in PR #100 (`e2e/pwa.spec.ts`, Chromium); unverified on Linux CI
  WebKit, which skips the test (D-32-18)
- **Used by:** D-77-16, D-166-6

### R-48 · Pull-to-refresh follows the root scroller's `overscroll-behavior`

- **Finding:** Chrome on Android triggers pull-to-refresh from the root scroller, so
  `overscroll-behavior-y: none` on `body` alone may not stop it; it is set on `html` too.
  Not yet checked on a real phone.
- **Source:** [MDN, overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior);
  [Chrome for Developers, Take control of your scroll](https://developer.chrome.com/blog/overscroll-behavior);
  device check outstanding (#77)
- **Used by:** D-77-14

### R-49 · fast-check replays a run exactly from its seed

- **Finding:** given `{ seed, numRuns }`, `fc.assert` generates the same sequence every
  time and, on failure, prints the seed and the shrunk counterexample's path to replay
  it. Determinism holds only if the property itself is deterministic, which is why the
  fuzz mocks uuid and runs its own seeded PRNG and clock.
- **Source:** [fast-check, Runners and reporters / replay](https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/)
- **Used by:** D-34-1, D-34-4

### R-50 · fake-indexeddb has no quota or eviction

- **Finding:** fake-indexeddb implements the IndexedDB API in memory with no storage
  limit, so a `QuotaExceededError` has to be simulated (a rejected `put`); an aborted
  transaction does roll back, so `putMany`'s atomicity is real. Real limits differ by
  browser (Safari caps per origin and may evict script-written storage after 7 days of
  no use); iOS may surface a full disk as `UnknownError` (unverified).
- **Source:** [fake-indexeddb README](https://github.com/dumbmatter/fakeIndexedDB);
  [MDN, Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria);
  iOS error name unverified
- **Used by:** D-34-7

### R-51 · Required status checks are unavailable on a private free-tier repo

- **Finding:** the branch-protection and rulesets APIs return 403 for this private
  repository on GitHub Free, so no check can be made required to merge; checks still run
  and report red. Protected branches and rulesets on private repos need Pro, Team or
  Enterprise.
- **Source:** observed in PR #103 (`gh api` on branch protection and rulesets);
  [GitHub Docs, About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- **Used by:** D-36-7

### R-52 · Redocly CLI 2 has no `preview-docs`

- **Finding:** `@redocly/cli` 2.x dropped the `preview-docs` command; `redocly preview`
  previews a Redocly project, not a bare spec. `build-docs` still renders one spec to a
  single static HTML file with no network or licence.
- **Source:** observed in PR #104 (`npx redocly --help`, CLI 2.48.0);
  [Redocly CLI, build-docs](https://redocly.com/docs/cli/commands/build-docs)
- **Used by:** D-38-11

### R-53 · Which commands load `.env`

- **Finding:** Next loads `.env` for `dev` and `build`; drizzle-kit loads it for
  `db:generate`, `db:push` and `db:studio`. The `tsx` scripts (`db:migrate`, `db:seed`,
  `db:reset`) do not, and fail with "DATABASE_USER is not set". `start:standalone` reads
  the copy `build` put in `.next/standalone/` (R-28). No longer true since #106: the copy is
  deleted after the build (D-106-2).
- **Source:** Measured in #38 fix round 3, with a `.env` present and nothing exported
- **Used by:** D-38-5, D-38-16, D-38-17

### R-54 · Next copies `.env` into the standalone output with no opt-out

- **Finding:** `writeStandaloneDirectory` in `next/dist/build/index.js` copies `.env` and
  `.env.production` into `.next/standalone/` whenever the build loaded them. No config
  option disables it; `outputFileTracingExcludes` filters traces only, not this copy.
- **Source:** `node_modules/next/dist/build/index.js` (Next 16.3.3, unchanged in 16.4.3);
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`
- **Used by:** D-106-2

### R-55 · `turbopackIgnore` must sit inside `join`, not only on the fs call

- **Finding:** Turbopack resolves `join(process.cwd(), "config.yaml")` (and the `.env`
  check) to project files and traces them into every server entry, even with
  `/* turbopackIgnore: true */` on the `readFileSync`/`existsSync` argument. Putting the
  comment inside the `join` empties those traces.
- **Source:** Observed in PR #107 (local build with a throwaway `config.yaml` and `.env`)
- **Used by:** D-106-1

### R-56 · An advisory lock is the only way to serialise "first admin"

- **Finding:** two concurrent check-then-insert transactions both see no admin under
  `READ COMMITTED`. `pg_advisory_xact_lock` blocks the second until the first commits or
  rolls back, and the blocked session is visible in `pg_locks` with `granted = false`,
  which lets a test force the interleaving. With the lock removed the forced test failed
  5 of 5 runs.
- **Source:** measured in PR #108;
  [PostgreSQL, Advisory Lock Functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
- **Used by:** D-105-5, D-105-9

### R-57 · `readline` in terminal mode echoes through its `output`

- **Finding:** `createInterface({ terminal: true })` writes typed characters to its
  `output` stream itself, so giving it a sink that discards writes (and printing the
  question directly) hides the input. Ctrl-C emits `SIGINT` on the interface and end of
  input emits `close`; both must reject or the promise hangs. Checked through a real pty:
  nothing echoed, Ctrl-C exited 1 with no row written.
- **Source:** measured in PR #108;
  [Node.js, readline](https://nodejs.org/api/readline.html)
- **Used by:** D-105-7

### R-58 · How `pg_locks` shows a single-bigint advisory lock

- **Finding:** `pg_advisory_xact_lock(bigint)` appears in `pg_locks` with
  `locktype = 'advisory'`, the high 32 bits in `classid`, the low 32 bits in `objid`, and
  `objsubid = 1` (the two-`int4` form uses 2). `database` is the lock's database, so
  matching all of these plus `granted = false` finds only waiters on that one key.
- **Source:** measured in PR #108;
  [PostgreSQL, `pg_locks`](https://www.postgresql.org/docs/current/view-pg-locks.html)
- **Used by:** D-105-9

### R-59 · Vitest workers inherit env set in globalSetup; Ctrl-C skips its teardown

- **Finding:** globalSetup runs once in the main process before any worker starts, and
  each worker's env is built from `process.env` afterwards, so a variable set there
  reaches every worker of that run only. Its returned teardown runs whether tests pass or
  fail, but not on Ctrl-C: Vitest exits on the first signal, and npm forwarding a second
  kills it. Measured: two concurrent integration runs went from 74 and 128 failures to
  687/687 each; no folder left after pass, fail, SIGINT or SIGTERM.
- **Source:** measured in PR #110;
  [Vitest, globalSetup](https://vitest.dev/config/#globalsetup)
- **Used by:** D-109-1, D-109-4

### R-60 · iOS Safari shows `:active` only when a touch listener exists (unverified on a device)

- **Finding:** By default Safari on iOS applies the `:active` state only when a
  `touchstart` handler is registered on the element or an ancestor. Without one, CSS press
  states show on Android and never on an iPhone. One passive, empty `touchstart` listener
  on `document` turns them on and changes nothing about scrolling or taps. Playwright's
  WebKit applies `:active` on mouse down regardless, so the E2E cannot prove this; it is a
  manual check on a real iPhone.
- **Source:** [MDN, `:active`](https://developer.mozilla.org/en-US/docs/Web/CSS/:active);
  #111 device audit
- **Used by:** D-111-11

### R-61 · Motion drops the starting velocity of a spring defined by duration or bounce

- **Finding:** In Motion 14.3.1, a spring given `duration`, `bounce` or `visualDuration`,
  and none of `stiffness`, `damping` or `mass`, is "time-defined". Its `velocity` is then
  replaced by 0, because "velocity from interrupted animations causes massive oscillation
  on small-range animations". A spring given physical `stiffness` and `damping` keeps its
  velocity. So a release velocity handed to a duration-based spring is lost: the sheet
  stalls under the finger, then sets off from rest. Apple's damping ratio ζ and response
  T convert as k = (2π/T)² and c = 2ζ√k, with mass 1.
- **Source:** `node_modules/motion-dom/dist/es/animation/generators/spring.mjs`
  (motion-dom 14.3.1), lines 158-177 (`getSpringOptions`, `isTimeDefined`) and 226 and
  240 (`inheritVelocity`); #111
- **Used by:** D-111-16

### R-62 · `font: -apple-system-body` and the iOS-only guard, per engine (measured)

- **Finding:** Probed with Playwright 1.62.1 on macOS:

  | Engine and profile | `(pointer: coarse)` | `-webkit-touch-callout` | `font: -apple-system-body` |
  | ------------------ | ------------------- | ----------------------- | -------------------------- |
  | WebKit, iPhone 13  | matches             | unsupported             | 13px                       |
  | Chromium, Pixel 5  | matches             | unsupported             | ignored (16px)             |

  So `@supports (-webkit-touch-callout: none)` is what keeps desktop Safari and the E2E's
  WebKit out. `pointer: coarse` alone would shrink the WebKit run to 13px. On iOS the
  keyword follows the text-size setting. Body sizes are 14, 15, 16, 17 (the default), 19,
  21 and 23px, then 28, 33, 40, 47 and 53px at the accessibility sizes. Not yet seen on a
  real iPhone.

- **Source:** measured 2026-10-19 in the #111 worktree;
  [MDN, `-webkit-touch-callout`](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout);
  [Apple HIG, Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- **Used by:** D-111-8, D-111-24

### R-63 · What a fixed or sticky box is positioned against

- **Finding:**
  - A `position: fixed` element is positioned against its nearest ancestor that has a
    `transform`, `filter` or `backdrop-filter`, not against the viewport.
  - A fixed overlay keeps any margin that a `space-y-*` parent gives it. Because of this,
    the End confirm's scrim stopped 20px short of the bottom on both engines.
  - A sticky element is confined to its containing block. A Save bar that is sticky inside
    a form starting low on the page cannot rise to the line above the nav.
  - On iOS Safari, `vh` is the large viewport, while `dvh` follows the visible area.
- **Source:** [CSS Transforms 1](https://www.w3.org/TR/css-transforms-1/);
  [Filter Effects 2](https://drafts.fxtf.org/filter-effects-2/);
  [CSS Positioned Layout 3](https://www.w3.org/TR/css-position-3/);
  [CSS Values 4, viewport-relative lengths](https://www.w3.org/TR/css-values-4/); #111 device
  audit
- **Used by:** D-111-13, D-111-20, D-111-31

### R-64 · What Motion costs the phone (measured)

- **Finding:** `LazyMotion` with `domAnimation` and `m` components loads animation, exit
  and gestures, but not layout or drag (`domMax`).
  - In the production build of the #111 branch, the one chunk holding Motion is 36.9 kB
    gzip (102.6 kB raw). That is about 9% of the 418 kB gzip of all client chunks.
  - Motion's own estimate for this feature set, quoted in PR #112, is about 29 kB.
  - The bundler follows static imports. A single static import under the root layout put
    Motion on every page, sign-in included. A dynamic `import()` gives it a chunk of its
    own.
  - The worker precaches every `.next/static` script, so the chunk downloads once per app
    version.
- **Source:** measured 2026-10-19 (`.next/static/chunks`, build of the #111 working tree);
  [Motion, reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size)
- **Used by:** D-111-2, D-111-15

### R-65 · What Playwright can emulate of the display settings

- **Finding:** Playwright 1.62.1 `emulateMedia` covers `reducedMotion` and `contrast` on
  both Chromium and WebKit; the suite's tests for both pass on each engine. Reduced transparency can be
  emulated only on Chromium, through CDP `Emulation.setEmulatedMedia`; WebKit cannot
  emulate it. Playwright's WebKit reports the computed `backdrop-filter` but draws no blur
  in screenshots. Safari's blur, grain and transparency fallback need a real device.
- **Source:** measured in PR #112 (`e2e/record-visit.spec.ts`, "the phone's display
  settings") and the #111 device audit;
  [Playwright, `page.emulateMedia`](https://playwright.dev/docs/api/class-page#page-emulate-media)
- **Used by:** D-111-19, D-111-32

### R-66 · Next 16: feedback while a link's route loads

- **Finding:** Called inside a `<Link>`, `useLinkStatus()` from `next/link` returns
  `pending` while that link's navigation is in progress. A route's `loading.tsx` lets the
  navigation commit at once, showing that file's UI. With neither, a tap on a dynamic route
  that is not prefetched shows nothing until the server answers.
- **Source:** `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
  (Next 16.3.3, unchanged in 16.4.3)
- **Used by:** D-111-12

### R-67 · Layout at the 32px text cap (measured)

- **Finding:** Before the fixes in PR #112's fourth and fifth rounds, at 32px:
  - on the iPhone 13 profile the install banner was 273px of a 664px screen (81px at the
    default), so with the nav it covered 60% of the screen;
  - the block screen's first paint put Save at 498 to 610px, under a nav starting at
    536px, and it jumped about 98px up on hydration;
  - "Record for a member" pushed Records 280px sideways, and the Sessions list squeezed
    each title to 2 to 20px.

  Changing the root font size, which is how an iOS text-size change reaches the page
  (D-111-24), resizes elements without resizing the viewport, so no `resize` event fires.
  Not yet seen on a real iPhone.

- **Source:** measured in PR #112 (`e2e/large-text.spec.ts` and the verifier's device
  pass); [CSSOM View, resizing viewports](https://drafts.csswg.org/cssom-view/#resizing-viewports)
- **Used by:** D-111-35, D-111-40, D-111-46, D-111-47

### R-68 · A submit button with no form owner does nothing

- **Finding:** A `type="submit"` button submits only its form owner: the form it is in,
  or the one its `form` attribute names. With neither, activating it does nothing. Before
  hydration, a submit button inside a `<form>` makes the browser submit natively, which
  loads a new page.

  _Extended (#113):_ a form with no submit button is still submitted by Enter (implicit
  submission) when it has exactly one field that blocks it, such as one text input;
  radios do not block. If the form's default button, its first submit button, is
  disabled, Enter submits nothing. Measured on both phone projects: before the page was
  live, Enter in the unit field reloaded `/blocks/X?` and emptied it; with a hidden,
  disabled submit first in the form, nothing happened.

- **Source:** [HTML, the button element](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element);
  [HTML, implicit submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission);
  measured in #113 (verifier round 0, reviewer probe on both engines)
- **Used by:** D-111-40, D-113-4

### R-69 · How iOS guards a sheet with unsaved changes

- **Finding:** UIKit's `isModalInPresentation` stops a sheet being dismissed
  interactively. The sheet still gives a little under a pull and springs back, and the
  system then calls `presentationControllerDidAttemptToDismiss(_:)`, where the app asks
  whether to discard. Apps set it only while there are unsaved changes, as Calendar's New
  Event sheet does.
- **Source:** [Apple, `isModalInPresentation`](https://developer.apple.com/documentation/uikit/uiviewcontroller/ismodalinpresentation);
  [Apple, `presentationControllerDidAttemptToDismiss(_:)`](<https://developer.apple.com/documentation/uikit/uiadaptivepresentationcontrollerdelegate/presentationcontrollerdidattempttodismiss(_:)>);
  [WWDC19, Modernizing Your UI for iOS 13](https://developer.apple.com/videos/play/wwdc2019/224/)
- **Used by:** D-111-42

### R-70 · A media query cannot see the reader's text size; a scaled `clamp()` can

- **Finding:** Relative units in a media query resolve against the initial font size
  (the browser's, usually 16px), never against declarations on the page. So
  `@media (max-height: 26.5rem)` ignores the `html { font: -apple-system-body }` that
  carries the iOS text size (D-111-24). A length that is the condition's margin times
  1000 is far past any screen, positive or negative. Subtracted inside
  `clamp(small, calc(full - var(--x)), full)`, it gives one bound or the other. That is
  resolved on the first paint and again when the root font size changes. With the
  E2E profiles' heights, the 26.5 reader-rem limit falls at about 25px of text on the
  iPhone 13 (664px) and 27px on the Pixel 5 (727px).
- **Source:** [Media Queries 4, units](https://www.w3.org/TR/mediaqueries-4/#units);
  measured in PR #112 (`e2e/large-text.spec.ts`)
- **Used by:** D-111-48

### R-71 · What the chrome leaves at 32px (measured)

- **Finding:** At 32px the nav is 128px (4 reader-rems) and the docked Save bar 160px
  (5 reader-rems). On the iPhone 13 profile (390×664) they cover 43%, leaving 44px under
  half the screen, less than one 48px line of 32px text. On the Pixel 5 (393×727), a
  compact sync bar brings the chrome to 46%. Measured locally on macOS with Playwright
  1.62.1 after fix round 6:
  - with nothing waiting, the unit field ends 16px above the Save bar on the iPhone 13
    and 79px above it on the Pixel 5;
  - with records waiting, 56px of the field's 96px is under Save on the iPhone 13.

  Not yet confirmed in CI: at 2f17288, CI's Linux WebKit found the field covered at
  32px, with scripts off (its bottom at 408px, the bar's top at 376px) and live.

- **Source:** measured in PR #112, fix round 6 (`e2e/large-text.spec.ts`,
  `e2e/record-visit.spec.ts`); CI run 39405474323
- **Used by:** D-111-49, D-111-50 and D-111-52 (both rejected, D-111-61)

### R-72 · A view timeline can style an element by whether another is in view

- **Finding:** `view-timeline-name` on one element, with `timeline-scope` on a common
  ancestor, lets a sibling run an animation along that element's visibility
  (`animation-timeline`). With `animation-range: cover 0% cover 1px` and
  `fill-mode: both`, the first keyframe holds until the element enters the viewport.
  No script is needed, so it works on the server's HTML. Where
  `@supports (animation-timeline: view())` fails, nothing applies. The animation follows
  scrolling, so a reduced-motion rule that shortens `animation-duration` must not reach
  it. Both Playwright engines draw it. The builder gives iOS 26 as the first iOS with
  scroll-driven animations; that is not checked on a device.
- **Source:** [MDN, `animation-timeline`](https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline);
  [MDN, `timeline-scope`](https://developer.mozilla.org/en-US/docs/Web/CSS/timeline-scope);
  measured in PR #112 (`e2e/record-visit.spec.ts`, scripts off at 16px and 32px)
- **Used by:** D-111-55

### R-73 · React 19 hydrates at once for a tap made before hydration, or drops it

- **Finding:** In react-dom 19.2.8, a discrete event (click, input, change, keydown and
  others in `discreteReplayableEvents`) that reaches a part of the tree not yet hydrated
  makes React hydrate it at once and then dispatch the event. An event fired before
  React has attached its listeners is not seen. In the verifier's hydration probe,
  typing a unit before the block screen was live left the field empty afterwards in 7 of
  8 runs. On WebKit an interest pick and a Save tap made before it was live were both
  kept: the pick held, and Save answered "Not saved. Enter the unit number."

  _Corrected (#113); the title read "React 19 replays a tap made before hydration":_ the
  event goes to its own target, after a synchronous hydration. If that part's code has
  not arrived it cannot hydrate, and React stops the event and drops it. Nothing replays
  a discrete event later; only continuous events (focus, hover) and form actions are
  queued. So a tap on the block screen's stand-in, a `type="button"` with no handler,
  never reaches the form's Save, a different element. Measured in #113: it saved
  nothing with every script held and with only the screen's held. The WebKit Save answer
  above is best read as a tap that reached the form's own Save just after it replaced
  the stand-in, with the unit cleared (R-125). Not re-measured.

- **Source:** `node_modules/react-dom/cjs/react-dom-client.development.js` (19.2.8),
  `discreteReplayableEvents` and the dispatch path that reads it (`dispatchEvent`,
  `queueIfContinuousEvent`, `scheduleReplayQueueIfNeeded`); measured in PR #112 (the
  verifier's hydration probe, fix round 5) and #113 (verifier rounds 0 and 2)
- **Used by:** D-111-40, D-113-5

### R-74 · iOS bars do not grow with Dynamic Type

- **Finding:** UIKit's tab bars and toolbars keep their size at every text size. At the
  accessibility sizes, a long press on an item shows it enlarged in the large content
  viewer instead. Not checked on a device.
- **Source:** [Apple, `UILargeContentViewerInteraction`](https://developer.apple.com/documentation/uikit/uilargecontentviewerinteraction)
- **Used by:** D-111-60

### R-75 · A container query's `rem` is the root's font size

- **Finding:** Relative units in a container query condition are evaluated against the
  query container's computed values, and `rem` there is still the root element's font
  size: the reader's text size (D-111-24). Resetting `--reader-rem` on an element does
  not change it, so a nav drawn at the 16px base needs a px threshold for its labels.
  _Amended by R-202 (#196):_ the root's size is the reader's only from 16 to 32px, as
  `--reader-rem` clamps it and the root does not.
- **Source:** [CSS Containment 3, the `@container` rule](https://drafts.csswg.org/css-contain-3/#container-rule);
  seen in PR #112, fix round 8
- **Used by:** D-111-60, D-196-2

### R-76 · What the chrome leaves once it stops growing (measured)

- **Finding:** With the chrome at the 16px base, the nav is 64px, the docked Save bar
  80px and the sync row 44px at every text size. On the iPhone 13 profile at 32px with
  records waiting, pinned chrome is 28% of the screen. From 16 to 32px on both profiles,
  with and without records waiting, the unit field is uncovered as the recording screen
  and the offline shell's form open.
- **Source:** measured in PR #112, fix round 8 (`e2e/large-text.spec.ts`); passed on CI's
  Linux Chromium and WebKit in run 39582214648
- **Used by:** D-111-60, D-111-61

### R-77 · Easing a `filter` crashes WPE WebKit on CI's Linux runners (measured)

- **Finding:** The WPE WebKit that Playwright runs on Linux segfaulted on its compositor
  thread (`ThreadedCompositor`, always `libWPEWebKit-2.0.so.1.10.2 + 0x5fd556a`) when a
  press's `filter` eased back. Writing the core dump took 20 to 100 s, during which the
  page neither painted nor exited, so tests timed out wherever they were; it looked like
  a stall. Full runs that eased a filter crashed in 15 of 15, including commits back to
  the first, and with the glass or the scroll-driven edges removed; runs without it, in
  0 of 8 (main, the head without the filter transition or without press transitions, and
  dedd6ee three times). Earlier green runs had their crashes land between tests. macOS
  WebKit, which composites through Core Animation as iOS Safari does, never reproduced
  it, so this is no evidence of a crash on an iPhone.
- **Source:** measured in PR #112, fix round 9, on scratch PR #114 (core dumps from
  `coredumpctl` after each CI run); CI run 39582214648 on dedd6ee
- **Used by:** D-111-67, D-111-68

### R-78 · `readdirSync` with `recursive: true` lists paths relative to the folder

- **Finding:** `fs.readdirSync(dir, { recursive: true, encoding: "utf8" })` returns every
  entry below `dir` as a path relative to it, e.g. `ui/sheet.tsx`, so a guard that names
  files that way sees the subfolders. The option arrived in Node 20.1 and 18.17; CI and
  the image run 24.
- **Source:** [Node.js `fs.readdirSync`](https://nodejs.org/api/fs.html#fsreaddirsyncpath-options);
  checked on Node 24 in PR #116
- **Used by:** D-115-7

### R-79 · In ESLint flat config, `*.ts` matches only files beside the config

- **Finding:** `files` patterns are matched relative to the config file's folder and `*`
  does not cross `/`, so the block of `["*.mjs", "*.ts", "*.config.*"]` that turns off
  type-aware rules covers root files only. `eslint --print-config` gives
  `src/auth/index.ts` and `test/vitest.setup.components.ts` `projectService: true` and
  `no-floating-promises` on; `playwright.config.ts` gets neither.
- **Source:** [ESLint, specifying files and ignores](https://eslint.org/docs/latest/use/configure/configuration-files#specifying-files-and-ignores);
  measured in PR #116
- **Used by:** D-115-10

### R-80 · `useSyncExternalStore` renders the server snapshot while hydrating

- **Finding:** `getServerSnapshot` is used on the server and during hydration on the
  client; React then re-renders with `getSnapshot` if it differs. So a value only the
  phone knows (`localStorage`, what another screen heard) can differ from the server's
  HTML without a hydration mismatch, and is drawn one render later.
- **Source:** [React, `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore);
  not measured here
- **Used by:** D-117-19, D-117-29

### R-81 · `localStorage` is per origin and can throw

- **Finding:** Storage is per origin in one browser, so on a shared phone it belongs to
  the phone, not the signed-in account. Reading `window.localStorage` throws
  `SecurityError` where storage is blocked, and `setItem` throws `QuotaExceededError` when
  the quota is used up.
- **Source:** [MDN, `Window.localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage),
  [MDN, `Storage.setItem`](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem);
  not measured here
- **Used by:** D-117-29

### R-82 · `FOR KEY SHARE` conflicts only with `FOR UPDATE`

- **Finding:** Of PostgreSQL's row-level locks, `FOR KEY SHARE` conflicts only with
  `FOR UPDATE`, which a `DELETE` or an update of a key column also takes; it is
  compatible with itself, `FOR SHARE` and `FOR NO KEY UPDATE`. So any number of visit writes can hold a session row at once,
  while an admin's change to its households, or a transition, waits for them and they
  for it. Verified by the parked-lock tests in
  `src/server/follow-ups/races.integration.test.ts`, which hold a real lock from a
  second connection.
- **Source:** [PostgreSQL, explicit locking, row-level locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS); #117
- **Used by:** D-117-45, D-123-1, D-123-2, D-132-2, D-132-4

### R-83 · A DELETE body has no defined meaning; a query string is logged

- **Finding:** RFC 9110 gives content in a DELETE request no generally defined
  semantics and warns some implementations may reject it. A query string is part of the
  request target, which access logs record by default (nginx's `combined` format logs
  `$request`, the whole request line). Not measured here.
- **Source:** [RFC 9110 §9.3.5, DELETE](https://www.rfc-editor.org/rfc/rfc9110#section-9.3.5),
  [nginx, `log_format`](https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format)
- **Used by:** D-117-34

### R-84 · Offset pages need a unique order

- **Finding:** PostgreSQL returns rows that tie on `ORDER BY` in no defined order, and
  the planner takes `LIMIT` and `OFFSET` into account, so different pages of one query
  can use different plans and order ties differently. Pages read with a non-unique order
  can repeat or skip rows; a unique last key (the id) makes the order total. Not
  measured here.
- **Source:** [PostgreSQL, LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
- **Used by:** D-117-51, D-207-1, D-207-2, D-207-8

### R-85 · Scroll anchoring moves a growing line above the anchor (measured)

- **Finding:** With scroll anchoring, when content above the anchor node changes size,
  the browser adjusts the scroll position so the anchor stays put. In the follow-up
  form, the status line above the unit field grew a row just after Save scrolled it into
  view; the page scrolled to hold the field, and the line's top went under the pinned
  "1 waiting to send". The E2E measured the line at 56px while sending and 86px once
  saved before the fix. Observed on Chromium; WebKit not checked here.
- **Source:** [CSS Scroll Anchoring Module Level 1](https://drafts.csswg.org/css-scroll-anchoring/);
  #117, `e2e/follow-up-session.spec.ts`
- **Used by:** D-117-59

### R-86 · React keeps a differing server attribute, and warns only in development

- **Finding:** React does not promise to patch attribute differences found while
  hydrating. In development it warns ("…some attributes of the server rendered HTML
  didn't match the client properties. This won't be patched up.") and names browser
  extensions among the causes; in production it keeps the server's value and reports
  nothing. Text and structure differences still throw #418 and re-render. Grammarly
  writes `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed` on `<body>` before
  hydration, which raises that warning on every page. A hydrated element holds the props
  React rendered in an undocumented `__reactProps$<id>` property, and Chromium drops
  console messages a page logs as it is left, so a check must keep its findings
  elsewhere.
- **Source:** [React, `hydrateRoot` caveats](https://react.dev/reference/react-dom/client/hydrateRoot);
  the Docker dev server's forwarded browser log; measured in #117 with a throwaway
  `data-tz-probe` attribute, which failed account and teams specs only with the sweep
- **Used by:** D-117-62, D-117-64

### R-87 · `usePathname()` reads the browser's address on a page served at another

- **Finding:** A prerendered page reached at a different URL (a rewrite, or here the
  worker's `/offline` fallback at the failed address) hydrates with `usePathname()`
  giving the browser's address, not the path the server rendered, so anything derived
  from it can mismatch. `useSelectedLayoutSegment()` comes from the rendered route tree
  and agrees on both sides. The offline-fallback specs in `pwa.spec.ts` failed with React
  #418 before the fix.
- **Source:** [Next.js, `usePathname`, avoid hydration mismatch with rewrites](https://nextjs.org/docs/app/api-reference/functions/use-pathname#avoid-hydration-mismatch-with-rewrites)
  (also `node_modules/next/dist/docs`); #117
- **Used by:** D-117-63

### R-88 · `Etc/GMT+12` is UTC−12

- **Finding:** The IANA `Etc/GMT±n` zones keep the POSIX sign, the reverse of what is
  usual: `Etc/GMT+12` is twelve hours behind UTC. `Pacific/Kiritimati` is UTC+14, the
  furthest ahead, so the two are 26 hours apart and never share a date. Asia/Singapore
  (UTC+8) and UTC differ in date only from 16:00 to 24:00 UTC. Not measured here.
- **Source:** [IANA tz database, `etcetera`](https://data.iana.org/time-zones/tzdb/etcetera)
- **Used by:** D-117-64

### R-89 · `scrollIntoView({ block: "nearest" })` aligns the far edge of a tall element

- **Finding:** With `nearest`, an element taller than the scrollport whose top is above
  the view is aligned by its bottom edge, so its top stays out of view. The recording
  form's wrapper (the Saved line, the unit field and a dozen chips) outgrew a Pixel 5,
  and the line ended above the screen; the E2E failed on both browsers before the fix.
- **Source:** [CSSOM View, scroll an element into view](https://drafts.csswg.org/cssom-view/#scroll-an-element-into-view);
  #117, `e2e/follow-up-session.spec.ts`
- **Used by:** D-117-77, D-119-22, D-136-10

### R-90 · `additionalProperties` does not see through `allOf`

- **Finding:** In JSON Schema 2020-12 (OpenAPI 3.1), `additionalProperties` knows only
  its own subschema's properties, so `false` on a base used in an `allOf` rejects every
  field another branch adds; `unevaluatedProperties: false` beside the `allOf` sees what
  every branch evaluated. The hey-api Zod plugin ignores both and emits a plain
  `z.object` (and `.and()` for the `allOf`), so an extra field is caught by
  `withContract`'s parsed-versus-returned comparison (R-6), not by the schema.
- **Source:** [JSON Schema 2020-12 Core, `unevaluatedProperties`](https://json-schema.org/draft/2020-12/json-schema-core#name-unevaluatedproperties);
  generated `src/generated/zod.gen.ts` (#117)
- **Used by:** D-117-68

### R-91 · zod 4.6.6 checks an array's size before its elements, but only with a max

- **Finding:** Up to 4.6.5, `$ZodArray` parses every element and keeps one issue per
  failing element, with no early stop, so one large array can exhaust memory. 4.6.6
  checks the array, set and map size bounds before it parses any element. An array with
  no `max` is still parsed element by element. Measured: 101 empty items sent to
  `/visits/sync` and 51 bad ids sent to `blockIds` each give one detail, on the array.
- **Source:** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5);
  [zod v4.6.6 release](https://github.com/colinhacks/zod/releases/tag/v4.6.6) (#6652);
  the #118 integration tests
- **Used by:** D-118-3, D-118-5, D-118-6, D-126-7

### R-92 · npm `overrides` against an exact pin, and where Serwist uses zod

- **Finding:** An override of a package the root depends on directly must have the same
  spec as that dependency, or npm fails with `EOVERRIDE`. Writing `"$zod"` makes the
  override follow the root's spec. `@serwist/build` and `@serwist/turbopack` 9.5.13
  depend on `zod` exactly `4.6.5`. `createSerwistRoute` is `force-static` with
  `dynamicParams = false`, so its zod validation and its `glob` run at `next build`,
  never per request.
- **Source:** [npm, package.json `overrides`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides);
  `npm view @serwist/turbopack dependencies.zod`;
  `node_modules/@serwist/turbopack/dist/index.mjs`
- **Used by:** D-118-3, D-118-9

### R-93 · With `images.unoptimized`, `/_next/image` is a 404

- **Finding:** With `images: { unoptimized: true }` in `next.config.ts`, the standalone
  server answers `404` to `/_next/image?url=%2Ficon-192.png&w=64&q=75`, while
  `/icon-192.png` is `200`. The Next docs say only that images are then served as they
  are.
- **Source:** measured, `e2e/pwa.spec.ts` (#118);
  `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` (Next 16.4.3)
- **Used by:** D-118-4

### R-94 · `npm audit --omit=dev` before and after #118

- **Finding:** At `95f591f` (run with `--package-lock-only`): 8 vulnerable packages,
  1 critical, 5 high and 2 moderate. `next` 16.0.0 to 16.4.0 is critical, with 11
  advisories, among them the image-optimizer SSRF (fixed in 16.3.8) and the SVG
  remote-code-execution one (fixed in 16.4.1). `zod` <4.6.6, `sharp` <0.35.5 and
  `source-map-js` 1.0.0 to 1.2.1 are high, and so are both `@serwist` packages, through
  zod. `glob` and `minimatch` are moderate. On the branch: 4 moderates, `glob` 3.0.0 to
  14.0.1 (GHSA-3g3m-2fjr-6pw4), `minimatch` <11.0.1 (GHSA-g3hv-75wg-m249) and the two
  `@serwist` packages that pull them in, with no fix available. A full `npm audit` still
  finds 7 high and 27 moderate, all in dev dependencies.
- **Source:** measured with `npm audit` on 2026-11-03; the first patched versions come
  from the GitHub advisory database (`gh api /advisories/<id>`)
- **Used by:** D-118-1, D-118-4, D-118-9

### R-95 · Dependabot groups and cooldown

- **Finding:** Groups whose `applies-to` is `security-updates` collect security PRs, and
  the default `version-updates` groups collect the scheduled ones. `update-types` can
  split majors from minor and patch updates. `cooldown.default-days` holds a new
  release back for that many days, for version updates only. Security updates also
  need Dependabot security updates turned on in the repository settings.
- **Source:** [GitHub Docs, Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- **Used by:** D-118-7, D-131-5

### R-96 · Who sets `Sec-Fetch-Site`, and when

- **Finding:** The browser sets it: `same-origin`, `same-site`, `cross-site`, or `none`
  for a request the user started (address bar, bookmark). A `Sec-` header is a forbidden
  request-header name, so no page can set or forge it. It is sent only to potentially
  trustworthy URLs (HTTPS, `localhost`), so a phone on plain `http` over a LAN gets none.
  Safari sends it from 16.4 (not tested here).
- **Source:** [Fetch Metadata Request Headers](https://w3c.github.io/webappsec-fetch-metadata/);
  [Fetch, forbidden request-header](https://fetch.spec.whatwg.org/#forbidden-request-header);
  [MDN, `Sec-Fetch-Site`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site)
- **Used by:** D-121-2, D-121-3

### R-97 · What another origin can send without a preflight

- **Finding:** A cross-origin form or `fetch` sends a body with no preflight only as
  `text/plain`, `application/x-www-form-urlencoded` or `multipart/form-data`, and only
  with CORS-safelisted headers; `application/json`, or a header like `X-Forwarded-Host`,
  needs a preflight the server must grant. A `SameSite=Lax` cookie goes with any request
  within the same site (registrable domain), so a sibling subdomain's POST carries it.
  The browser adds `Origin` to every request that is not `GET` or `HEAD`: `null` for an
  opaque origin (sandboxed frame, `file:`) or a form under `Referrer-Policy: no-referrer`;
  a `fetch` always sends the real one.
- **Source:** [Fetch, CORS-safelisted request-header](https://fetch.spec.whatwg.org/#cors-safelisted-request-header);
  [Fetch, append a request `Origin` header](https://fetch.spec.whatwg.org/#append-a-request-origin-header);
  [RFC 6265bis, `SameSite`](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- **Used by:** D-121-3, D-121-4, D-121-5, D-121-6

### R-98 · Next.js builds `request.url` from the bind address

- **Finding:** Unless `experimental.trustHostHeader` is set, a route handler's
  `request.url` is the server's own `hostname:port` (default `localhost`), with the
  scheme from `X-Forwarded-Proto`, not the `Host` the browser sent. Behind a proxy it
  does not name the public origin. Same cause as R-30.
- **Source:** `next` 16.3.3, `dist/server/lib/router-utils/resolve-routes.js` (`initUrl`)
- **Used by:** D-121-5, D-124-8

### R-99 · Which reverse proxies pass the public `Host`

- **Finding:** nginx sends the upstream's host (`proxy_set_header Host $proxy_host` is
  its default) and no `X-Forwarded-Host`. Caddy passes `Host` through and sets
  `X-Forwarded-Host`. Traefik passes `Host` (`passHostHeader`, default true). Read, not
  tested here.
- **Source:** [nginx, `proxy_set_header`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header);
  [Caddy, `reverse_proxy` headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers);
  [Traefik, pass host header](https://doc.traefik.io/traefik/routing/services/#pass-host-header)
- **Used by:** D-121-5

### R-100 · An `Origin` never names its scheme's default port; a forwarded host may

- **Finding:** The URL parser stores a port equal to the scheme's default as no port,
  and an origin is serialized with its port only when it has one, so a browser sends
  `Origin: https://app.example.org`, never `:443`. `new URL()` does the same (measured,
  Node 24: `https://Example.org:443` has host `example.org`; `http://example.org:443`
  keeps `:443`). nginx's `$server_port` is the port that accepted the request, so
  `proxy_set_header Host $host:$server_port` forwards `app.example.org:443` (read, not
  tested here).
- **Source:** [URL Standard, port state](https://url.spec.whatwg.org/#port-state);
  [HTML, serialization of an origin](https://html.spec.whatwg.org/multipage/browsers.html#ascii-serialisation-of-an-origin);
  [nginx, `$server_port`](https://nginx.org/en/docs/http/ngx_http_core_module.html#var_server_port)
- **Used by:** D-121-10

### R-101 · JavaScript's `\s` and `trim()` strip the same characters (measured)

- **Finding:** ECMAScript defines both over WhiteSpace and LineTerminator. A check of
  every code point in Node 24.19 found no difference between `/^\s$/u` and `trim()`
  leaving `""`. So a value that matches `\S` is never empty after `trim()`. U+200B (zero
  width space) is neither, so it matches `\S` and survives `trim()`. U+00A0 and U+FEFF
  are both.
- **Source:** [ECMA-262, `String.prototype.trim`](https://tc39.es/ecma262/#sec-string.prototype.trim)
  and CharacterClassEscape `\s`; measured on the #119 worktree
- **Used by:** D-119-1, D-119-8

### R-102 · PostgreSQL's `btrim(text)` strips only spaces (measured)

- **Finding:** With one argument, `btrim` removes U+0020 and nothing else. On
  PostgreSQL 17.11, `btrim(E'\t x \n')` keeps the tab and the newline, while
  `btrim('   ')` is `''`. So `btrim(col) <> ''` refuses `''` and values of only spaces,
  but not a value of only tabs.
- **Source:** [PostgreSQL, string functions](https://www.postgresql.org/docs/current/functions-string.html);
  measured with `psql`
- **Used by:** D-119-4, D-119-10

### R-103 · A new CHECK is tested against existing rows, and pending migrations share one transaction

- **Finding:** Unless the constraint is added `NOT VALID`, `ALTER TABLE … ADD CONSTRAINT …
CHECK` scans the table. On a row that fails, it stops with SQLSTATE 23514, `check
constraint "<name>" of relation "<table>" is violated by some row`. drizzle-orm
  0.45.2's `migrate()` runs every pending migration inside one `session.transaction`,
  so that failure applies nothing from the run.
- **Source:** [PostgreSQL, ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html);
  `node_modules/drizzle-orm/pg-core/dialect.js` (`migrate`)
- **Used by:** D-119-5, D-119-9

### R-104 · A read-only transaction refuses writes

- **Finding:** In drizzle-orm 0.45.2, `transaction(fn, { accessMode: "read only" })`
  opens with `begin read only`. In such a transaction PostgreSQL refuses `INSERT`,
  `UPDATE` and `DELETE` on permanent tables, as well as DDL.
- **Source:** [PostgreSQL, SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html);
  `node_modules/drizzle-orm/node-postgres/session.js` (`transaction`)
- **Used by:** D-119-9

### R-105 · An alert dialog is described by its message

- **Finding:** The ARIA alert dialog pattern gives `role="alertdialog"` an accessible
  name, and an `aria-describedby` that points at the alert's message, so that the
  message is announced with the dialog even when focus goes to a button inside it. Taken
  from the pattern page; not checked with a screen reader here.
- **Source:** [WAI-ARIA APG, Alert and Message Dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
- **Used by:** D-119-19

### R-106 · Focusing a control scrolls it into view unless `preventScroll` is set

- **Finding:** `focus()` scrolls each scroll container that holds the element until the
  element is in view, unless it is called with `{ preventScroll: true }`. With focus on
  OK, a Not saved pop-up taller than the screen opened scrolled to its foot, its heading
  cut away. This was seen at the largest text in #119's `e2e/large-text.spec.ts`.
- **Source:** [HTML Standard, `focus()`](https://html.spec.whatwg.org/multipage/interaction.html#dom-focus)
- **Used by:** D-119-21

### R-107 · Playwright fails a `test.fail` test that passes

- **Finding:** In Playwright 1.62.1, `test.fail(condition, description)` marks the test
  "should fail" when the condition is true. The runner then checks that it really
  fails: a failure counts as a pass, and a pass fails the run. So a known failure turns
  the run red once it is fixed, and the mark has to come off then. Taken from the API
  docs; not run here.
- **Source:** [Playwright, `test.fail`](https://playwright.dev/docs/api/class-test#test-fail);
  `node_modules/playwright/types/test.d.ts`
- **Used by:** D-119-33, D-136-11

### R-108 · Next's proxy body cap truncates a body; it never refuses one

- **Finding:** For a request the proxy matches, Next 16.4.3 buffers the body up to
  `experimental.proxyClientMaxBodySize` (default 10 MB). The route handler gets only
  that much. Next logs one `console.warn` (`Request body exceeded …`) and drops the rest
  as it arrives. Nothing answers `413`. Shown in a production build by
  `e2e/auth.spec.ts`: credentials sent after a 2.5 MB pad are never read.
- **Source:** `node_modules/next/dist/server/body-streams.js` (`cloneBodyStream`);
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`
- **Used by:** D-120-7, D-120-13, D-126-6, D-126-12 (refined by R-130)

### R-109 · Next fills `X-Forwarded-For` only when it is absent

- **Finding:** Next 16.4.3 sets `x-forwarded-for` to the socket's remote address with
  `??=`, so it never appends. A header the client sent reaches the handler unchanged,
  and with no proxy in front, every entry in it is the client's to choose. A route
  handler is given no socket address.
- **Source:** `node_modules/next/dist/server/base-server.js` (`x-forwarded-for`)
- **Used by:** D-120-5, D-120-10, D-120-12

### R-110 · Auth.js hands `authorize` a rebuilt `Request` with the original headers

- **Finding:** For a Credentials `POST`, @auth/core 0.41.3 calls
  `provider.authorize(credentials, new Request(url, { headers, method, body }))`. The
  body is re-serialised, but the headers are the incoming ones, so `X-Forwarded-For`
  reaches `authorize`.
- **Source:** `node_modules/@auth/core/lib/actions/callback/index.js`
- **Used by:** D-120-5

### R-111 · Sweeping a V8 `Map` from the front is not O(1) (measured)

- **Finding:** A V8 `Map` keeps deleted entries as holes until it rehashes. A new
  iterator starts at the front and walks over them. So a sweep that deletes from the
  front and re-inserts renewed keys at the back can walk every hole in front of the
  first live window on each call, until the next rehash. The #120 reviewer measured the
  limiter's `consume` on Node 24: about 1 µs at 1k live keys, 16 µs at 10k and 100 µs at
  100k. The hole mechanism is taken from V8's ordered hash table; it was not traced here.
- **Source:** measured in the #120 review; V8 `src/objects/ordered-hash-table.h`
- **Used by:** D-120-2, D-120-3

### R-112 · An `X-Forwarded-For` entry with a port is not an IP to `node:net`

- **Finding:** `isIP("1.2.3.4:80")` and `isIP("[::1]:80")` are `0`, while
  `isIP("::ffff:1.2.3.4")` is `6` (measured, Node 24.19). So a proxy that writes
  `ip:port` entries leaves no usable entry. That Azure App Service writes them comes from
  the #120 builder and was not checked against Azure here.
- **Source:** [Node.js, `net.isIP`](https://nodejs.org/api/net.html#netisipinput);
  measured with `node -e`
- **Used by:** D-120-12

### R-113 · Auth.js names its cookies after the scheme unless `useSecureCookies` is set

- **Finding:** In @auth/core 0.41.3, the cookie names and `Secure` flag come from
  `useSecureCookies ?? url.protocol === "https:"`. With the flag on, the names are
  `__Secure-authjs.session-token` and `__Host-authjs.csrf-token`. A route handler's `url`
  is the request's own URL, and under Next its scheme comes from `X-Forwarded-Proto`,
  which is `http` when the proxy sends none (R-98). In next-auth 5.0.0-beta.32, the
  proxy's session lookup (`getSession`) builds its URL with `createActionURL`, which
  falls back to `https` when no `X-Forwarded-Proto` arrives. So with the flag unset,
  the two can disagree on the cookie name. This is the builder's finding; a test in
  `src/proxy-secure-cookies.test.ts` covers the fixed path.
- **Source:** `node_modules/@auth/core/lib/init.js`, `lib/utils/cookie.js`
  (`defaultCookies`), `lib/utils/env.js` (`createActionURL`);
  `node_modules/next-auth/lib/index.js` (`getSession`)
- **Used by:** D-122-12

### R-114 · zod 4 probes `new Function` once per page unless it is jitless

- **Finding:** In zod 4.6.7, `util.allowsEval` tries `new Function("")` when the first
  object schema is built, and caches the result for the rest of that page. Each object
  schema reads `jitless` when it is built, so the setting must come before any schema.
  zod catches the throw, but a CSP without `'unsafe-eval'` still reports the attempt.
  zod's own comment says so. `config({ jitless: true })` skips the probe. Next runs
  `instrumentation-client.ts` before the app becomes interactive.
- **Source:** `node_modules/zod/v4/core/util.js` (`allowsEval`),
  `node_modules/zod/v4/core/schemas.js` (object schema);
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`
- **Used by:** D-122-7

### R-115 · Chromium and WebKit report different violations under Report-Only (measured)

- **Finding:** With zod's JIT left on, Playwright Chromium (Pixel 5) fired a
  `securitypolicyviolation` for `script-src` eval under Report-Only, and 7 of 7 page
  tests failed. Playwright WebKit (iPhone 13) fired none for eval under Report-Only. It
  did fire for an off-site image, a fetch and an `<object>`. Under the enforced header,
  both engines block eval and report it. WebKit logs on every page that a report-only
  policy without `report-to` "will have no effect", yet it still fires the events.
- **Source:** measured by #122's verifier (rounds 0 and 1) and builder, local
  production build
- **Used by:** D-122-3, D-122-7, D-122-8

### R-116 · Which `Clear-Site-Data` type clears what

- **Finding:** Per the spec, `"cache"` removes the origin's locally cached data. That
  means the HTTP cache, and possibly others such as the bfcache. `"storage"` covers
  localStorage, sessionStorage, IndexedDB, service worker registrations and Cache
  Storage. The header is honoured only in a secure context, which includes `localhost`
  and `127.0.0.1`. Measured by #122's verifier, against a real server on both
  Playwright engines: `"storage"` wiped IndexedDB, Cache Storage and localStorage, and
  `"cache"` left all three alone. A `route.fulfill` response does not trigger the header
  in either engine. Not measured: whether either engine actually empties its HTTP cache
  or bfcache on `"cache"`, and the same result on a real iPhone.
- **Source:** [W3C Clear Site Data](https://w3c.github.io/webappsec-clear-site-data/);
  [MDN, Clear-Site-Data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data);
  measured (#122 verifier, round 1)
- **Used by:** D-122-10; no longer sent since D-218-1 (R-210)

### R-117 · What a Report-Only CSP cannot do, and how policies combine

- **Finding:** A `Content-Security-Policy-Report-Only` policy blocks nothing, and that
  includes `frame-ancestors`. `upgrade-insecure-requests` is ignored in a report-only
  policy. When a response carries several policies, each one is enforced, so a request
  must pass all of them. A second CSP added by a proxy can only narrow the app's. A
  dedicated worker or service worker takes its policy from its own script's response,
  and its violations fire in the worker's global scope, not in any document.
- **Source:** [W3C CSP Level 3](https://www.w3.org/TR/CSP3/) (report-only, multiple
  policies, worker policy);
  [W3C Upgrade Insecure Requests](https://www.w3.org/TR/upgrade-insecure-requests/)
- **Used by:** D-122-3, D-122-4, D-122-8

### R-118 · HSTS is ignored over http, and `includeSubDomains` covers every subdomain

- **Finding:** A browser must ignore `Strict-Transport-Security` that arrives over an
  insecure transport. `includeSubDomains` applies the rule to every subdomain of the
  host that sent it, for the whole `max-age`. Preload lists require `includeSubDomains`.
- **Source:** [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797) §6.1.2, §8.1;
  [hstspreload.org](https://hstspreload.org/)
- **Used by:** D-122-5

### R-119 · What `next.config` `headers()` reaches (measured)

- **Finding:** In Next 16.4.3, `headers()` is evaluated at `next build` and written to
  `.next/routes-manifest.json`. Measured on the standalone build, its headers reach
  pages, static files, route handlers, the PWA paths, and the `401` and `307` the proxy
  writes. Next's own trailing-slash `308` carries none of them. Next's automatic
  `OPTIONS` `204` and its `405` for a method a route does not export
  (`new Response(null, { status })`) carry them, but get no `Cache-Control`.
- **Source:** `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`;
  `node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`;
  measured with curl (#122 verifier, rounds 0 and 1)
- **Used by:** D-122-1, D-122-9, D-122-13

### R-120 · What Auth.js's default logger prints, and how a custom one replaces it

- **Finding:** In `@auth/core` 0.41.3 the default `error` prints
  `[auth][error] <type>: <message>` in ANSI red. For an `AuthError` that wraps an error,
  it then prints that error's stack and, as `[auth][details]`, a JSON dump of the cause's
  other properties. Otherwise it prints the error's own stack. An `AuthError` built from
  an error keeps it as `cause.err` and copies that error's own `cause` properties beside
  it. jose's `JWTExpired` keeps the decoded `payload` in its cause, so an expired token's
  claims reached `[auth][details]`. `warn` prints the code and a URL. `debug` prints its
  metadata as JSON and is off unless `debug` is set. `setLogger` uses each level the
  config supplies and keeps the default for the others.
- **Source:** `node_modules/@auth/core/lib/utils/logger.js`;
  `node_modules/@auth/core/errors.js`; `node_modules/jose/dist/webapi/util/errors.js`
  (jose 6.2.10); reproduced by the audit (#128) and the #128 verifier
- **Used by:** D-128-1, D-128-2, D-128-3

### R-121 · Error names do not survive minification; Auth.js types and jose codes do

- **Finding:** jose and Auth.js both set `name = this.constructor.name`, which the
  production build mangles. In the proxy's bundle and the route's, the same jose error
  had different names. jose's `code` (for example `ERR_JWT_EXPIRED`) is a class field
  holding a string literal, and Auth.js's `type` (for example `JWTSessionError`) comes
  from a static string. Both survive minification.
- **Source:** `node_modules/jose/dist/webapi/util/errors.js`;
  `node_modules/@auth/core/errors.js`; measured on the standalone build (#128 builder)
- **Used by:** D-128-2

### R-122 · next-auth's `auth()` wrapper adds its cookies after the handler answers

- **Finding:** In next-auth 5.0.0-beta.32, `handleAuth` runs the session check, then the
  wrapped handler. It copies the handler's answer into `new Response(body, response)`
  and then appends the session check's `Set-Cookie` headers: a CSRF cookie for a request
  that has none, the callback URL, and a refreshed session. The handler never sees those
  cookies on its own response.
- **Source:** `node_modules/next-auth/lib/index.js` (`handleAuth`)
- **Used by:** D-150-1

### R-123 · `no-store` already covers `private`; Next sends a static page as `s-maxage=31536000`

- **Finding:** `no-store` tells every cache not to store any part of the response. That
  includes shared caches, so adding `private` changes nothing. In Next 16.4.3 a static
  (prerendered) page is sent with `s-maxage=31536000`, and a dynamic one with
  `private, no-cache, no-store, max-age=0, must-revalidate`. On the standalone build, a
  `Cache-Control` the proxy sets on `NextResponse.next()` replaces the page's own
  (measured).
- **Source:** [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111) §5.2.2.5, §5.2.2.7;
  `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md`; measured with curl
  (#122 verifier round 1, #128 verifier round 0)
- **Used by:** D-150-2, D-150-3

### R-124 · An UPDATE of no key column takes `FOR NO KEY UPDATE`; deleting a parent checks its children `FOR KEY SHARE` (measured)

- **Finding:** `FOR UPDATE` is taken by a `DELETE` and by an `UPDATE` that changes a
  column with a unique index a foreign key can use; any other `UPDATE` takes
  `FOR NO KEY UPDATE`. An amend changes only interest, description and `updated_at`, so
  its UPDATE holds what an explicit `FOR NO KEY UPDATE` does. Deleting a referenced row
  runs the foreign key's check on the referencing rows `FOR KEY SHARE`, which waits for
  `FOR UPDATE` but not `FOR NO KEY UPDATE` (R-82). Measured: with an amend holding its
  visit `FOR UPDATE` and parked before reading the membership, disbanding the visit's
  team (members deleted, then the team) and the amend each waited on the other, and
  PostgreSQL reported `deadlock detected`; with `FOR NO KEY UPDATE` the disband was
  refused at once by the foreign key and the amend applied.
- **Source:** [PostgreSQL, explicit locking, row-level locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS);
  PostgreSQL `src/backend/utils/adt/ri_triggers.c` (the restrict check's
  `FOR KEY SHARE OF x`); measured (#123 builder, `src/server/visits/sync-races.integration.test.ts`)
- **Used by:** D-123-2, D-132-4

### R-125 · React keeps what was typed into a field while hydrating, but not in state

- **Finding:** In react-dom 19.2.8, hydrating an `<input>` leaves its DOM `value` and
  `checked` as they are (`initInput` skips both while hydrating), so a unit typed or a
  radio picked before then is still on screen. State does not learn it: no change event
  is fired, and the next render of a controlled input writes the state's value back.
  Measured in #113 on both engines: a unit typed before the block screen was live
  reverted to `""` or to the `?unit=` one, and a Save then said "Enter the unit
  number".
- **Source:** `node_modules/react-dom/cjs/react-dom-client.development.js` (19.2.8),
  `initInput`; measured in #113 (builder's probe with the scripts held)
- **Used by:** D-113-1, D-113-2

### R-126 · An urgent update above a screen still being hydrated throws its HTML away

- **Finding:** In react-dom 19.2.8, an update that reaches a Suspense boundary still
  dehydrated, a context change included, first makes React try to hydrate it sooner. If
  its code has not arrived, an update in a transition is held back
  (`renderDidSuspendDelayIfPossible`) and the server's HTML stays. An urgent one is not:
  the boundary is rendered on the client without hydrating
  (`retrySuspenseComponentWithoutHydrating`), and its HTML, typed into, is replaced by
  the fallback. Measured in #113 on both phones: with only the block screen's chunk
  held, Auth.js's session answering (an urgent `setState` in its `SessionProvider`)
  showed "Loading the block…" and lost the unit and level. Through a transition the
  screen's HTML stayed. The new E2E failed 6 of 6 before and passed 30 of 30 after.
- **Source:** `node_modules/react-dom/cjs/react-dom-client.development.js` (19.2.8), the
  dehydrated path of `updateSuspenseComponent`; measured in #113 (verifier rounds 1 and
  2, builder fix round 2)
- **Used by:** D-113-7

### R-127 · A ticked radio comes back from history unless it is `autocomplete="off"`

- **Finding:** A page loaded again from history, not from the back/forward cache, gets
  its form controls' state back from the browser, a ticked radio included, while the
  page's script starts afresh. `autocomplete="off"` on the control stops it. Measured
  in #113 on both phone projects: after a pick, a full load and Back, High came back
  ticked with the unit blank; with the attribute, no level was ticked.
- **Source:** [HTML, the `autocomplete` attribute](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill);
  measured in #113 (verifier round 0, builder fix round 1)
- **Used by:** D-113-3

### R-128 · A deactivation waits for `FOR SHARE` on the user, not for `FOR KEY SHARE` (measured)

- **Finding:** `FOR SHARE` conflicts with `FOR NO KEY UPDATE` and `FOR UPDATE`;
  `FOR KEY SHARE` only with `FOR UPDATE` (R-82). Setting `deactivated_at` changes no key
  column, so its UPDATE takes `FOR NO KEY UPDATE` (R-124): it waits for a visit write
  holding the author `FOR SHARE`, never for the `KEY SHARE` the visit's foreign key
  takes. Measured in #132: with the author locked `FOR SHARE` before the session, a
  deactivation parked behind a recording that held it, and both landed; with
  `KEY SHARE`, or the lock taken after the session, the deactivation did not wait and
  the test failed.
- **Source:** [PostgreSQL, explicit locking, row-level locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS);
  measured (#132 builder, `src/server/follow-ups/races.integration.test.ts`). Measured
  again in #158 for team placement (`src/server/teams/placement-races.integration.test.ts`).
- **Used by:** D-132-4, D-132-5, D-132-8, D-158-2, D-158-5, D-158-7, D-180-6

### R-129 · A locking SELECT locks in its `ORDER BY` order and re-checks its filter on a row it waited for

- **Finding:** Under READ COMMITTED, `SELECT ... FOR <mode>` finds only rows committed
  when the statement began. On a row another transaction holds it waits; once that
  commits, it re-evaluates the `WHERE` clause on the new version and returns and locks
  the row only if it still matches. A row that came to match after the statement began
  is never seen. `ORDER BY` is applied before the locking clause, so rows are locked in
  sort order; `EXPLAIN` shows `LockRows` above `Sort`. So two `updateUser` calls lock the
  admins in one id order, the second drops an admin the first demoted, and an admin
  promoted meanwhile is not counted.
- **Source:** [PostgreSQL, Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED);
  [PostgreSQL, SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
  `EXPLAIN` measured (#132 reviewer). In #158 a placement without the `ORDER BY`, queued
  behind a deactivation, deadlocked with it (`placement-races.integration.test.ts`).
- **Used by:** D-132-2, D-132-5, D-158-2, D-158-5, D-158-7, D-180-3, D-180-6

### R-130 · Next's proxy cut drops the chunk that crosses it (measured)

- **Finding:** In Next 16.4.3, `cloneBodyStream` counts each chunk before passing it on.
  The chunk that takes the count past `proxyClientMaxBodySize` is not passed on: both
  copies of the body end there. So the handler gets the bytes before that chunk, which
  can be up to one chunk short of the cut. This refines R-108's "drops the rest". In a
  production build, a 2.5 MB body sent with a `Content-Length`, and the same body sent
  chunked, both reached the handler over the 1.5 MiB sync cap and were answered `413`.
- **Source:** `node_modules/next/dist/server/body-streams.js` (16.4.3, `cloneBodyStream`);
  measured in #126 (`e2e/auth.spec.ts`; the verifier's curl checks, round 2)
- **Used by:** D-126-6, D-126-12

### R-131 · Postgres takes at most 65,535 bind parameters in one statement (measured)

- **Finding:** The extended protocol's Bind message carries the parameter count as a
  16-bit integer, so one statement binds at most 65,535 values. An `inArray` binds one
  per id, and an insert binds one per column per row: about 21,846 rows of three columns,
  or 32,767 of two. Measured in #126: before chunking, a household with 70,000 visits
  failed `attachTeams` and listed as `500`, and `createTeam` failed with 22,000 members.
- **Source:** [PostgreSQL, message formats (Bind)](https://www.postgresql.org/docs/current/protocol-message-formats.html);
  measured in #126 (builder, each test run against the old code)
- **Used by:** D-126-3, D-126-7

### R-132 · Rows skipped by `OFFSET` are still computed; a count is index-only only if the index covers its filter

- **Finding:** Postgres still computes the rows an `OFFSET` skips, so an expression in a
  paged query's select list runs for every skipped row too. A `count(*)` filtered only on
  `household_id` can be answered from `visits_household_created_idx` alone, when the
  visibility map allows. With `session_id` in the filter as well, it must fetch each heap
  row, because the index does not hold that column. Either way the work grows with the
  household's visits. From the docs; not measured here.
- **Source:** [PostgreSQL, LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html);
  [PostgreSQL, index-only scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
- **Used by:** D-126-1, D-126-9

### R-133 · Drizzle's lateral joins qualify the outer column (rendered)

- **Finding:** In drizzle-orm 0.45, a subquery built with the query builder and joined with
  `crossJoinLateral` or `leftJoinLateral` renders an outer column it references with its
  table (`"households"."id"`). Raw `sql` interpolation renders the same column
  unqualified (R-7). The lateral form therefore correlates correctly without raw SQL.
- **Source:** the #126 summaries query rendered with `.toSQL()` (builder; reviewer,
  rounds 1 and 2)
- **Used by:** D-126-1

### R-134 · A streaming `TextDecoder` decodes as `Request.text()` does

- **Finding:** `text()` runs the Encoding standard's "UTF-8 decode". That strips one
  leading byte-order mark and replaces invalid bytes with U+FFFD. `new TextDecoder()`
  (UTF-8, not fatal, BOM not ignored) does the same, and `decode(chunk, { stream: true })`
  holds back a character split across chunks until the next one arrives. Pinned by
  `contract.test.ts` ("decodes a body that arrives in pieces as request.text() would").
- **Source:** [Fetch, `text()`](https://fetch.spec.whatwg.org/#dom-body-text);
  [Encoding, UTF-8 decode](https://encoding.spec.whatwg.org/#utf-8-decode);
  [Encoding, `TextDecoder`](https://encoding.spec.whatwg.org/#interface-textdecoder)
- **Used by:** D-126-4

### R-135 · How many bytes a body the contract admits can take (measured)

- **Finding:** zod's string `max` counts UTF-16 code units. In UTF-8, a unit costs at
  most 3 bytes as written (a BMP character); a character outside the BMP is 4 bytes for
  two units. `JSON.stringify` writes a control character other than `\b`, `\t`, `\n`, `\f`
  and `\r`, and a lone surrogate, as a 6-byte `\uXXXX` escape. Measured in #126:
  - a sync batch of 100 records with every field at its `maxLength` in 3-byte characters
    is 1,309,547 bytes, and was answered `200`;
  - one record of escapes only is about 26 KB, so only a batch reaches the 1.5 MiB cap;
  - a `createVisit` or `createSession` at its maximums is under a tenth of 256 KiB;
  - a UUID in a JSON array costs 39 bytes, so 256 KiB holds about 6,700 ids.
- **Source:** [ECMAScript, `QuoteJSONString`](https://tc39.es/ecma262/#sec-quotejsonstring);
  `src/server/http/body-limit.test.ts`; measured in #126 (verifier, round 1)
- **Used by:** D-126-4, D-126-7, D-126-11

### R-136 · What Playwright can show of a back/forward-cache restore (measured)

- **Finding:** Playwright launches Chromium with `--disable-back-forward-cache`, so no
  page is ever restored in the suite. With the full Chromium channel and that flag
  removed, a page comes back with `pageshow` `persisted=true`. Even then two things keep
  this app's pages out in Chromium: next-auth's `BroadcastChannel` message evicts them
  (`notRestoredReasons: broadcastchannel-message`), and the page a `location.replace`
  leaves is never cached. With that message muted and `no-store` and `Clear-Site-Data`
  stripped, History and the admin's Team list came back after sign-out when the guard
  was off, and reloaded into sign-in when it was on. With only `no-store` stripped,
  Chromium still restored the page, but that `Clear-Site-Data` arrived on a
  `route.fulfill` response, which R-116 found no engine honours, so it says nothing about
  the header. Playwright's WebKit never restored any page, not even the cacheable
  `/offline`. Not measured: WebKit or an iPhone over HTTPS.
- **Source:** `playwright-core` 1.62.1 `chromiumSwitches` ("Avoids surprises like main
  request not being intercepted during page.goBack()"); `next-auth` 5.0.0-beta.32
  `react.js` (`getSession` posts on the `next-auth` channel); measured (#129 verifier,
  rounds 0 and 1)
- **Used by:** D-129-1, D-129-10

### R-137 · A late answer sets the session cookie again after sign-out (measured)

- **Finding:** An answer to a request sent with the session, delivered after Auth.js's
  sign-out answer, carries a refreshed session cookie (R-122) and puts the cookie back, on
  both Playwright engines. Once a navigation has replaced the page, its own fetches are
  cancelled and set nothing; while `/sign-in` is still loading, Chromium may still store
  such an answer and WebKit drops it. A fetch the service worker makes is not cancelled
  with the page: in Chromium its answer, released 3 s after `/sign-in` had looked, signed
  the member back in (2 of 2). Playwright's WebKit cannot hold a worker's request, so
  whether iOS cancels it is unknown. _Since #125:_ the cookie such an answer sets names a
  sign-in the server has ended, so it signs nobody in. Held on mobile-chromium, the late
  cookie still landed, and the API answered `401` and `/api/auth/session` `null`
  (`sign-ins.spec`; #125 verifier, round 1).
- **Source:** measured (#129 verifier, rounds 1 and 2; #125 verifier, round 1)
- **Used by:** D-129-4, D-129-5, D-125-19

### R-138 · `page.route` does not see what a service worker fetches

- **Finding:** Playwright's docs say `page.route` and `browserContext.route` do not
  intercept requests a service worker handles, and recommend `serviceWorkers: "block"`
  when intercepting. In Chromium `context().route` did stop the worker's own sync sends
  (`pwa.spec`); in WebKit it could not, and Playwright supports service workers only on
  Chromium.
- **Source:** `playwright-core` 1.62.1 `types.d.ts` (`page.route`, `browserContext.route`,
  `serviceWorkers`); measured (#129 builder and verifier)
- **Used by:** D-129-10, D-164-5, D-151-8

### R-139 · OWASP's CSV injection guidance names tab and CR, and the field separator

- **Finding:** OWASP lists `=`, `+`, `-`, `@`, tab (0x09) and carriage return (0x0D) as
  the leading characters to defuse with a quote, and warns that a field separator such
  as `;`, or a quote, inside the value can start a new cell with one of them mid-value.
  (Read by the #129 planner, the quotes clause cited by the #163 reviewer; not fetched
  again by either docs step.)
- **Source:** [OWASP, CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- **Used by:** D-129-9, D-163-1

### R-140 · `router.replace` moves the address only when the server answers, and loads the page if that fails (measured)

- **Finding:** On `/admin/history?q=…`, `router.replace` to the address without `q` left
  `q` in the address until the RSC fetch for it answered, and meanwhile every request of
  the first load carried the old URL in `Referer` (`same-origin`): 23 on Chromium, 13 on
  WebKit. An aborted or `500` RSC fetch gave a second document load, search empty; with
  no signal, the Offline page. Next 16.4.3, production build, both phone projects.
- **Source:** #163 verifier, round 0 (Playwright network logs). #245's verifier r0 saw
  the same wait on All records' filters: a picked date read blank until the server
  answered.
- **Used by:** D-163-6, D-245-5, D-246-10, D-257-1

### R-141 · Next syncs `useSearchParams` with `history.replaceState` through a patch its router installs in an effect

- **Finding:** The app router replaces `history.pushState` and `replaceState` in a
  `useEffect`. A call whose state has `__NA` or `_N` goes straight to the native method
  and tells the router nothing; any other gets Next's `__NA` and
  `__PRIVATE_NEXTJS_INTERNALS_TREE` copied in, and the router is restored to the URL,
  which is what moves `useSearchParams`. On `popstate`, an entry with no state is ignored
  and one without `__NA` reloads the page. So a call before the patch must carry
  `history.state` itself. The docs promise the sync, not when the patch is in place.
- **Source:** `node_modules/next/dist/client/components/app-router.js` (16.4.3; the
  patch re-read unchanged in 16.4.5, lines 274-324, by #245's docs step);
  `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`,
  "Native History API"
- **Used by:** D-163-6, D-245-5, D-246-10, D-257-1, D-257-2, D-257-3

### R-142 · On first load the shell's requests leave before a screen inside `<Suspense>` hydrates (measured)

- **Finding:** React hydrates a server-rendered Suspense boundary in a later pass, at
  `OffscreenLane` (`react-dom-client.production.js` 7180-7182, Next 16.4.3's compiled
  React), so the shell around it commits and runs its effects first. On
  `/admin/history?q=…`, `/api/auth/session`, the bottom nav's RSC prefetches, the HTML's
  static chunks and, on WebKit, the manifest carried `Referer: …?q=…`. The screen's own
  API calls, and every request after the strip, carried nothing.
- **Source:** React as above; #163 verifier, round 1 (header probe, both phone projects)
- **Used by:** D-163-9

### R-143 · How a spreadsheet reading with `;` splits the export (modelled, not run in one)

- **Finding:** A `"` counts only where it opens a field. To a `;` reader our `,` is no
  separator, so every `"` past a row's first cell is text, a `;` or line break inside a
  value ends a field (a line break, the row), and a `"` that opens such a field is
  unwrapped. Split that way, by Python's `csv` with `;`, and by a raw scan after every
  `;` and line break, the real export from both engines left no field that starts a
  formula, and Python's comma reader returned ordinary text as typed. Not checked in
  Excel, LibreOffice or Sheets set to `;` (owner check on #163).
- **Source:** `semicolonFields` in `src/lib/csv.test.ts`; #163 verifier, round 1
  (`check_csv.py` on the exported files)
- **Used by:** D-163-1, D-163-2

### R-144 · A job's `permissions` replaces the workflow's for that job

- **Finding:** `permissions` can sit at the top of a workflow, for every job, or in one
  job, whose steps then get exactly the access it names. So a single job-level grant
  widens the token for that job whatever the top level says.
- **Source:** [GitHub Docs, workflow syntax: `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
- **Used by:** D-131-1

### R-145 · `actions/checkout` leaves the token on disk unless `persist-credentials: false`

- **Finding:** By default checkout keeps the token for the rest of the job, so later git
  commands are authenticated, and removes it at post-job cleanup. Since v6 it is written
  to a file under `$RUNNER_TEMP` that git still reads, not into `.git/config` itself.
  `persist-credentials: false` writes it nowhere.
- **Source:** [actions/checkout README at v7.0.1](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md)
  ("Checkout v6", "Usage")
- **Used by:** D-131-2

### R-146 · The pinned action releases are lightweight tags on their major's commit

- **Finding:** On 2026-11-12 `actions/checkout` v7.0.1 and v7 were both `3d3c42e5…`,
  `actions/setup-node` v7.1.0 and v7 `949feb24…`, `actions/upload-artifact` v7.0.2 and v7
  `cf430e03…`, and `actions/cache` v6.1.0 and v6 `55cc8345…`. Every ref points straight
  at a commit, so none needed dereferencing. Dependabot updates an `owner/repo@<sha>`
  action and a version comment on the same line.
- **Source:** `gh api repos/actions/<name>/git/matching-refs/tags/v<major>` (#131
  builder, reviewer and docs); [GitHub Docs, supported ecosystems: GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#github-actions)
- **Used by:** D-131-3

### R-147 · The images' multi-arch index digests, and how often they move

- **Finding:** `postgres:17-alpine` is the OCI image index `sha256:e5d2edd2…` (16
  manifests) and `node:24-alpine` the index `sha256:116b800c…` (6: amd64, arm64, s390x,
  each with an attestation). An index digest still lets each machine pull its own
  platform. Each tag is re-pushed with a new digest often: `node:24-alpine` 7 times in
  the four weeks to 2026-11-12, never more than 7 days apart; `postgres:17-alpine` 7
  times since 2026-10-22, once 10 days apart.
- **Source:** docker-library/repo-info, `repos/postgres/remote/17-alpine.md` and
  `repos/node/remote/24-alpine.md` and their commit history, read with `gh api` on
  2026-11-12. The registry itself was not queried (a local hook blocks curl to it, and
  Docker was not running); the PR's CI pull is the check.
- **Used by:** D-131-4, D-131-5

### R-148 · What Dependabot's image updaters read

- **Finding:** `docker` updates images in Dockerfiles and in Kubernetes manifests or Helm
  charts; `docker-compose` updates Compose v2 and v3 files. `github-actions` updates only
  `uses:` in `owner/repo@ref` form, not `docker://`. None names a workflow's
  `services.<id>.image`. Neither image ecosystem gets security updates, only version
  updates. A digest pin is updated to the digest Dependabot checked, which must match
  the registry's metadata. Its Docker Hub cooldown dates a tag by `tag_last_pushed`, so
  pushing the tag again can restart the cooldown. Dependabot works from the default branch unless
  `target-branch` says otherwise.
- **Source:** [GitHub Docs, supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories),
  [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference);
  [dependabot-core `docker/README.md`](https://github.com/dependabot/dependabot-core/blob/main/docker/README.md)
  ("Cooldown publication dates")
- **Used by:** D-131-5, D-131-6

### R-149 · A caret on a prerelease takes every later prerelease of that version

- **Finding:** `^5.0.0-beta.32` means `>=5.0.0-beta.32 <6.0.0`, and prereleases of
  5.0.0 itself are allowed from beta.32 up, so any later beta satisfies it. Measured: npm
  11.17.0's `npm install --package-lock-only` changed the lockfile's root entry and also
  added six bundled `@tailwindcss/oxide-wasm32-wasi` entries, which were reverted by
  hand; `npm ci` then installed the same tree.
- **Source:** `node_modules/semver/README.md`, "Caret Ranges"; #131 builder (measured)
- **Used by:** D-131-7

### R-150 · drizzle's migrator hashes each migration file with SHA-256

- **Finding:** drizzle-orm 0.45.2's `readMigrationFiles` hashes each `.sql` file's whole
  text with SHA-256 (hex), and the Postgres migrator stores that value in
  `__drizzle_migrations.hash`. `drizzle/meta/_journal.json` holds no hashes, only tags
  and timestamps.
- **Source:** `node_modules/drizzle-orm/migrator.js` (line 23),
  `node_modules/drizzle-orm/pg-core/dialect.js` (line 67)
- **Used by:** D-131-9

### R-151 · An answer that lands inside a field's `input` event is drawn at once, and writes the old value back (measured)

- **Finding:** In WebKit, the continuation of a `fetch` can run inside the `input` event
  of text landing in a field: after the field has changed, between React's capture and
  bubble listeners at the document. In react-dom 19.2.8, an update with no priority set
  takes it from `window.event` (`resolveUpdatePriority`), and `input` is discrete, so it
  is drawn at once. Drawn with the state it still holds, a controlled input gets its old
  value written back, and React's value tracker with it (`track`), so
  `getInstIfValueChanged` sees no change and `onChange` never fires. An update in
  `startTransition` is drawn after the event. A `useSyncExternalStore` change is always
  drawn at `SyncLane` (`forceStoreRerender`), whatever lane its caller had.
  Measured: in #155's builder probe, which recorded only the `value` setter's writes,
  answers released 4 to 5 ms before `fill` lost the unit in 1 of 80 WebKit runs, with
  one write, `#05-123` over `#09-999`, from React's commit while `window.event` was
  `input`. Releasing the answers from a capture `input` listener lost it 10 of 10 on
  both engines without transitions, 0 of 10 with them. Not seen with a real keystroke
  or paste, which fire `keydown` or `paste` before the field changes.
- **Source:** `node_modules/react-dom/cjs/react-dom-client.development.js` (19.2.8),
  `resolveUpdatePriority`, `getEventPriority`, `forceStoreRerender`, `track`,
  `getInstIfValueChanged`; measured in #155 (builder probe; verifier rounds 0 to 2)
- **Used by:** D-155-1, D-155-2, D-155-3, D-155-6, D-155-7, D-171-1, D-171-2, D-176-2

### R-152 · Next names a loopback host `localhost` in the URL a route reads

- **Finding:** Next's `NextURL` rewrites any `127.x.x.x`, `[::1]` or `localhost` host to
  `localhost`. Auth.js therefore builds Google's callback URL on `localhost` when the app
  is reached at `127.0.0.1`. The cookies set before leaving for Google are on
  `127.0.0.1`, so the browser does not send them back to the `localhost` callback, and
  the round trip fails. The Google E2E runs on `localhost`. A deployment has one name for
  itself, so only the test harness meets this.
- **Source:** `node_modules/next/dist/server/web/next-url.js` (`parseURL`,
  `REGEX_LOCALHOST_HOSTNAME`), Next 16.4.3; measured (#125 builder)
- **Used by:** D-14-14

### R-153 · next-auth passes a lazy config the request only on its own routes

- **Finding:** With a config function, next-auth 5.0.0-beta.32 calls it with the request
  from its route handlers (`handlers.GET`, `handlers.POST`), from the middleware form and
  from the `auth(handler)` wrapper. A bare `auth()` call in a server component or route
  handler calls it with `undefined`. The app's proxy builds its own instance from the base
  config, so only Auth.js's `/api/auth/*` routes reach the app's config with a request.
  The server-side `signOut` that `NextAuth()` returns calls it with `undefined` too.
- **Source:** `node_modules/next-auth/index.js` (`httpHandler`, the returned `signOut`),
  `node_modules/next-auth/lib/index.js` (`initAuth`)
- **Used by:** D-125-4, D-125-20

### R-154 · A `jwt` callback that returns `null`, or throws, clears the session cookie

- **Finding:** In `@auth/core` 0.41.3's session action with the JWT strategy, a `jwt`
  callback that returns `null` makes the answer name no session and clean the session
  cookies. One that throws is logged as `JWTSessionError`, and the cookies are cleaned
  too.
- **Source:** `node_modules/@auth/core/lib/actions/session.js`
- **Used by:** D-125-4, D-125-13, D-181-1

### R-155 · Auth.js swallows an `events.signOut` error and clears the cookie anyway

- **Finding:** `@auth/core` 0.41.3's sign-out decodes the token and awaits
  `events.signOut`. Every event is wrapped by `eventsErrorHandler` in `init.js`, which
  catches an error from it and logs it as `EventError`. Only a token that fails to decode
  reaches sign-out's own catch, logged as `SignOutError`. The session cookie is cleaned
  either way. _Corrected (#125 review, 2026-11-12):_ this entry said an event error was
  logged as `SignOutError`.
- **Source:** `node_modules/@auth/core/lib/actions/signout.js`,
  `node_modules/@auth/core/lib/init.js` (`eventsErrorHandler`)
- **Used by:** D-125-9 (its known limit), D-125-20

### R-156 · How Auth.js links an OAuth account

- **Finding:** In `@auth/core` 0.41.3's OAuth callback with JWT sessions, a session
  cookie already present is decoded, and its user is read through the adapter's
  `getUser(sub)`. A new OAuth account is then linked to that signed-in user. With no
  such user:
  - An account already linked to this provider id signs in.
  - Otherwise, an account with the profile's email is linked only if the provider sets
    `allowDangerousEmailAccountLinking`. Without that setting, the result is
    `OAuthAccountNotLinked`.
  - With no match, `createUser` is called.

  The provider's `account()` decides which token fields are stored on the link.

- **Source:** `node_modules/@auth/core/lib/actions/callback/handle-login.js`
- **Used by:** D-14-3, D-14-4, D-14-7, D-249-2

### R-157 · Auth.js's OAuth requests take a custom `fetch` and allow `http`

- **Finding:** `@auth/core` 0.41.3 hands the provider's `[customFetch]` (exported by
  `next-auth`) to oauth4webapi for discovery, the token request and the JWKS. It also
  always sets `allowInsecureRequests`. So a test can stand in for Google's servers in
  process, and an `http` issuer works for a local stand-in.
- **Source:** `node_modules/@auth/core/lib/actions/callback/oauth/callback.js`,
  `node_modules/@auth/core/lib/actions/signin/authorization-url.js`
- **Used by:** D-14-14

### R-158 · Google is authoritative for an address only at gmail.com or with `hd`

- **Finding:** Google's guidance on ID tokens says to use `email`, `email_verified` and
  `hd` to decide whether Google is authoritative for an address. It is for an
  `@gmail.com` address, and for one whose token has `email_verified` true and carries
  `hd`, a Google Workspace account. Elsewhere `email_verified` means only that Google
  checked the address when the Google account was made; ownership of that mailbox may
  have changed since. `hd` is the hosted domain of the user's Workspace or Cloud
  organisation, sent only for its accounts. The app reads `hd` as the organisation's
  primary domain, which its secondary domains' accounts carry too; that reading was not
  checked against Google here (owner check on `tjc.org`, #14).
- **Source:** Google Identity,
  [Authenticate with a backend server](https://developers.google.com/identity/sign-in/web/backend-auth)
  and [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
  Cited from Google's documentation, not fetched in this session (the session's network
  guard refused both pages); paraphrased, not quoted.
- **Used by:** D-14-19, D-14-20

### R-159 · Auth.js's Google profile is the validated ID token's claims

- **Finding:** Google is an OIDC provider in `@auth/core` 0.41.3 (`type: "oidc"`). Its
  callback validates the ID token and hands its claims to the `signIn` callback as
  `profile`, with no userinfo request. So `email`, `email_verified` and `hd` there are
  the signed token's.
- **Source:** `node_modules/@auth/core/lib/actions/callback/oauth/callback.js`
  (`getValidatedIdTokenClaims`), `node_modules/@auth/core/providers/google.js`
- **Used by:** D-14-19

### R-160 · next-auth/react's `signOut` hands back the body whatever the status

- **Finding:** In next-auth 5.0.0-beta.32, the client `signOut` posts to `/signout`,
  reads the answer as JSON and, with `redirect: false`, returns that body without looking
  at the status. A `500` with `{"url": …}` therefore reads like any other answer, and a
  body that is not JSON throws. It also tells the other tabs a sign-out happened, either
  way.
- **Source:** `node_modules/next-auth/react.js` (`signOut`)
- **Used by:** D-125-21

### R-161 · Postgres orders uuids by their bytes, and the contract takes either case

- **Finding:** Postgres compares two `uuid` values byte by byte, which is the order of
  their lower-case text, and prints them in lower case whatever case they were written
  in. Plain string order differs once the case does: `"0B…" < "0a…"` as strings, but
  `'0B…'::uuid > '0a…'::uuid`. Zod 4's `z.uuid()`, which the generated request schemas
  use for `memberIds` and `userId`, accepts upper- and lower-case hex. Measured on
  PostgreSQL 17.11 in #158.
- **Source:** [PostgreSQL, UUID type](https://www.postgresql.org/docs/current/datatype-uuid.html);
  `uuid_internal_cmp` (`memcmp`) in PostgreSQL's `src/backend/utils/adt/uuid.c`;
  `node_modules/zod/v4/core/regexes.js` (`uuid`); measured with `psql` (#158 docs)
- **Used by:** D-158-2, D-158-6, D-180-1, D-180-2, D-193-1, D-193-6

### R-162 · Without an `ORDER BY`, a locking SELECT locks in its scan's order (measured)

- **Finding:** `LockRows` locks rows as the plan below it returns them, so a
  `SELECT … FOR SHARE` with no `ORDER BY` locks in scan order. A scan of the primary key
  returns key order, which hides a missing `ORDER BY`; a seq scan, and a bitmap heap scan
  (which sorts the row locations into physical order before fetching), return storage
  order. With `enable_indexscan` and `enable_indexonlyscan` off, `EXPLAIN` of #158's
  placement lock showed a seq scan, or a bitmap heap scan with seq scans off too; with
  the `ORDER BY`, a `Sort` sits under `LockRows`. In #158's id-order test, on
  PostgreSQL 17.11 (CI runs `postgres:17-alpine`): before the pin, the test passed
  without the `ORDER BY` in 1 run of 8. With it, the test failed without the `ORDER BY`
  10 of 10 (builder) and 8 of 8 (reviewer), each a `40P01` deadlock, and passed with it
  10 of 10 and 6 of 6. With index scans forced on every other connection, it still
  failed 3 of 3 without and passed 3 of 3 with.
- **Source:** [PostgreSQL, Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
  (bitmap heap scan order); [PostgreSQL, planner method configuration](https://www.postgresql.org/docs/current/runtime-config-query.html#GUC-ENABLE-INDEXSCAN).
  Cited, not fetched (the session's network guard refused them). Measured (#158 builder
  and reviewer, `src/server/teams/placement-races.integration.test.ts`; `EXPLAIN` by
  the #158 docs step).
- **Used by:** D-158-7, D-158-9

### R-163 · `scrollIntoView` counts a box under a fixed nav as in view; a scroll margin keeps it clear (measured)

- **Finding:** `scrollIntoView({ block: "nearest" })` measures against the whole
  viewport, fixed bars included. Without a bottom `scroll-margin`, Sign out under the
  nav on an iPhone 13 (ending at 630, the nav at 600) did not move, and at 32px on a
  Pixel 5 it was brought only to the screen's bottom edge, behind the nav. The margin is
  met only as far as the page can scroll, so at its end the box can sit flush on the
  nav. `overflow: hidden`, D-90-8's lock, stops the member scrolling, not a script: the
  scroll ran while "Sign out anyway" was still closing, on both engines.
- **Source:** [CSS Scroll Snap 1, `scroll-margin`](https://drafts.csswg.org/css-scroll-snap-1/#propdef-scroll-margin);
  [CSS Overflow 3, `hidden`](https://drafts.csswg.org/css-overflow-3/#valdef-overflow-hidden);
  measured (#164 builder and verifier, Pixel 5 and iPhone 13)
- **Used by:** D-164-1, D-164-3, D-164-7, D-164-8, D-151-7, D-213-1, D-213-2

### R-164 · Playwright 1.64 fires `online` for a document loaded offline; 1.62 does not (measured)

- **Finding:** in Chromium, after `context.setOffline(true)` and a reload, 1.62.1 leaves
  `navigator.onLine` true and `setOffline(false)` fires no `online`. 1.64.1 reads false
  and fires exactly one, as a phone does, so `/offline` reloads itself (D-33-22) in any
  test that goes offline and back. 1.64.1 alone, on Next 16.4.3 and React 19.2.8, fails
  the old retry test as #175 did. A context route that aborts every request leaves
  `navigator.onLine` true on both. Amends R-47.
- **Source:** #175's CI (run 43238677792); measured (#166 builder's bisect, #166 verifier,
  1.62.1 and 1.64.1 on Chromium). WebKit not measured: it skips these tests (D-32-18)
- **Used by:** D-166-3, D-166-4, D-166-6, D-166-7

### R-165 · Playwright's WebKit fails a routed request before the service worker (measured)

- **Finding:** with `context.route("**/*", (route) => route.abort(...))`, a navigation in
  a page the worker controls never reaches the worker in WebKit: the page stays where it
  was, with "Load failed". In Chromium the worker takes the navigation, the route fails
  the worker's own fetch, and the worker's fallback answers: with the fallback removed,
  the test fails at the Offline heading. Extends R-22 to routed requests; agrees with
  R-138.
- **Source:** measured (#166 builder's WebKit probe; #166 verifier, retry test with the
  skip lifted and with the fallback removed)
- **Used by:** D-166-4, D-166-5

### R-166 · A page can be in the worker's charge before its copy reads `"activated"`

- **Finding:** once, on WebKit in CI, a page whose `navigator.serviceWorker.controller`
  was already set read `registration.active.state` as `"activating"`. `clientsClaim` is
  off (D-32-6), and a navigation to a worker still activating waits for activation: with
  `activate` blocked, `controlled()`'s reload never finished on either engine. So the
  page's copy of the state trails the worker. Forty single reads on macOS WebKit all
  read `"activated"`, so the lag has been seen only in CI.
- **Source:** CI run 41825880661 (#159, WebKit); measured (#166 verifier: 40 single
  reads, activation blocked on both engines). Why WebKit's copy trails is not measured
- **Used by:** D-166-1, D-166-2

### R-167 · typescript-eslint 8 takes TypeScript below 6.1

- **Finding:** typescript-eslint 8.68.0 (main) and 8.72.1 (#175) declare the peer
  `typescript: >=4.8.4 <6.1.0`, as does its eslint plugin, so `npm ci` refuses TypeScript
  7.0.2 with `ERESOLVE` (#174). 6.0 is inside the range.
- **Source:** `node_modules/typescript-eslint/package.json` and
  `@typescript-eslint/eslint-plugin`'s (8.68.0); #174's failed install; #166 verifier
- **Used by:** D-166-9

### R-168 · Dependabot's `ignore` holds back security updates too

- **Finding:** an `ignore` entry applies to security updates as well as version updates,
  unlike `cooldown`, which holds back version updates only (R-95).
  `update-types: ["version-update:semver-major"]` drops majors, and `versions` takes a
  range in the package manager's own syntax (`">=25"`).
- **Source:** [GitHub Docs, Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
  (`ignore`, `cooldown`), read by the #166 reviewer; not re-read by the docs step (no
  network)
- **Used by:** D-166-9, D-166-10, D-166-11

### R-169 · Next's dev-resource guard sees only its own paths, and passes no `Origin`

- **Finding:** In `next` 16.4.3, `blockCrossSiteDEV` runs in the router server, before
  the proxy, and only on paths containing `/_next` or `/__nextjs` (not `/_next/image` or
  `/_next/static/media`). It allows `localhost`, `**.localhost`, the `-H` hostname and
  `allowedDevOrigins`. It judges a cross-site `no-cors` request by `Referer` and anything
  else by `Origin`, and a request with no `Origin` passes. It never reads `Host` and
  never sees an app route. A DNS-rebound page's same-origin GET therefore reaches every
  dev resource, while its hot-reload websocket, which carries `Origin`, is refused.
  Measured by #124's verifier: `/_next/static` answered `200` to a rebound host, and
  `/_next/hmr` was refused.
- **Source:** `node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js`,
  `node_modules/next/dist/server/lib/router-server.js`; measured (#124 verifier)
- **Used by:** D-124-8, D-124-9, D-124-10

### R-170 · A production build drops a dev-only proxy branch, and the standalone server forces `production`

- **Finding:** Next inlines `process.env.NODE_ENV` when it builds the proxy, so a
  `NODE_ENV === "development"` branch is not in the production output: the dev `403`
  message is found only in a `.map` file under `.next/server`. The standalone
  `server.js` sets `process.env.NODE_ENV = 'production'` before anything loads, so
  starting it with `NODE_ENV=development` still refuses a `not-for-production` secret.
- **Source:** `.next/standalone/server.js` (generated by `next build`, Next 16.4.3);
  measured (#124 verifier)
- **Used by:** D-124-7, D-124-8

### R-171 · Compose interpolates every service before any command

- **Finding:** Docker Compose resolves `${VAR}` across the whole file before it runs
  anything. A required `${VAR:?message}` on one service fails every command, even one
  naming only another service (`config --quiet b` exits 1 with
  `required variable ... is missing a value`).
- **Source:** measured with Docker Compose v5.5.1 on a scratch file (`docker compose
config`, parse only; #124 docs step, confirming the planner's check)
- **Used by:** D-124-7

### R-172 · Where a server bound to `127.0.0.1` can be reached

- **Finding:** `next dev -H 127.0.0.1` listens on IPv4 loopback only: `[::1]` refuses the
  connection. Chromium and WebKit opening `http://localhost:<port>` fall back from `::1`
  to `127.0.0.1` without trouble. Inside a container, a published port forwards to the
  container's own interface, never its loopback, so a server there must bind `0.0.0.0`
  to be reached; the host side of the mapping (`127.0.0.1:3000:3000`) decides who on
  the host's network can connect.
- **Source:** measured (#124 verifier: `lsof`, curl, both Playwright engines); Docker,
  [Port publishing](https://docs.docker.com/engine/network/port-publishing/)
- **Used by:** D-124-6, D-124-10

### R-173 · `npm run <script> -- <args>` appends the args to the script's last command

- **Finding:** npm adds the arguments after `--` to the end of the script's command line.
  For `db:reset` (`tsx scripts/migrate.ts && tsx scripts/seed.ts`), `--demo` reaches
  `seed.ts` only. Measured: `npm run db:reset -- --demo` migrated, then the seed ran
  with the flag.
- **Source:** npm, [`npm run-script`](https://docs.npmjs.com/cli/commands/npm-run-script);
  measured (#124 verifier)
- **Used by:** D-124-1

### R-174 · The `yaml` package ignores `<<` merge keys unless asked

- **Finding:** `yaml` 2.9.0 parses as YAML 1.2, where `<<` is an ordinary key: a service
  built from `<<: *script` reads as `{ "<<": {...} }`. With `{ merge: true }` the anchor's
  keys are merged in, as Compose does.
- **Source:** measured (`node`, `yaml` 2.9.0, #124 docs step);
  [yaml options](https://eemeli.org/yaml/#options)
- **Used by:** D-124-18

### R-175 · `npx` installs a missing package without asking when there is no TTY

- **Finding:** `npm exec` (`npx`) prompts before installing a package that is not in the
  project's dependencies, but assumes `--yes` when standard input is not a TTY or a CI
  environment is detected. It then installs the package into npm's cache and runs it;
  a package named without a version gets the `tag` config's version, `latest` by
  default, not the lockfile's. Compose's `web` sets no `tty`, so `npx next` with no
  `node_modules/.bin/next` fetches the latest `next` from the registry.
- **Source:** npm 11.17.0's bundled docs, `commands/npm-exec.md` and `using-npm/config.md`
  (`tag`), read offline (#124 docs step); npm,
  [`npm exec`](https://docs.npmjs.com/cli/commands/npm-exec)
- **Used by:** D-124-19

### R-176 · Auth.js checks a credentials sign-in's CSRF token before `authorize`, and tells the page `MissingCSRF`

- **Finding:** for the credentials provider, `@auth/core` runs `validateCSRF` before the
  `callback` action, so a refused token never reaches `authorize`. With
  `X-Auth-Return-Redirect`, which next-auth/react's `signIn` sends, the refusal is a `200`
  `{ url: "<sign-in page>?error=MissingCSRF" }`. Only client-safe types reach that URL;
  any other error reads `Configuration`. `signIn({ redirect: false })` returns the URL's
  `error`. It fetches a new token from `/api/auth/csrf` on every call, and sends an empty
  one when that fetch fails. Extends R-41, sign-out's `200` refusal, to sign-in.
- **Source:** `@auth/core` 0.41.3 `lib/index.js` (the `callback` case) and `index.js`
  (its `catch`); `next-auth` 5.0.0-beta.32 `react.js` (`signIn`, `getCsrfToken`) and
  `lib/client.js` (`fetchData`); pinned by `src/app/api/auth/[...nextauth]/route.test.ts`
- **Used by:** D-151-1, D-151-3, D-151-4

### R-177 · Next's route announcer has `role="alert"`

- **Finding:** the App Router appends a `next-route-announcer` element to `body`, with an
  open shadow root holding a `div` with `role="alert"` and `aria-live="assertive"`.
  Playwright's `getByRole("alert")` pierces open shadow roots, so a page-wide lookup can
  find it beside the app's own alert. It sits outside `main`.
- **Source:** `next` 16.4.3 `dist/client/components/app-router-announcer.js`; unchanged
  in 16.4.5 (#214).
- **Used by:** D-151-9, D-214-6

### R-178 · `vi.clearAllMocks` keeps queued once-answers; `mockReset` drops them

- **Finding:** `mockClear`, which `vi.clearAllMocks` calls, clears a mock's calls and
  results but keeps its implementations, including any queued with
  `mockResolvedValueOnce`. `mockReset` also resets "all 'once' implementations".
  Vitest 5's default `clearMocks` (R-185) calls the same `mockClear`, so it keeps them
  too, and D-151-11's `mockReset` is still needed.
- **Source:** `@vitest/spy` 5.1.0 (first read on 4.1.11) `dist/index.d.ts`,
  the `mockClear` ("does not reset implementations") and `mockReset` doc comments
- **Used by:** D-151-11, D-187-1

### R-179 · A multi-row INSERT waits mid-statement on an uncommitted unique key, so opposite orders deadlock (measured)

- **Finding:** an INSERT checks each row against a unique index as it inserts it. On a
  key another transaction has inserted but not committed, it waits for that
  transaction, still holding the rows it has already inserted. So two multi-row INSERTs
  with the same keys in opposite orders can each hold a key the other waits on, and
  Postgres fails one with `40P01 deadlock detected`. In the same order the second waits
  at the first key they share and, once the first commits, fails there with `23505`.
  Measured on PostgreSQL 17.11 in #180: with a third member's key held so both mutual
  placements parked, inserting in caller order gave `40P01`; in id order, one team and
  one `23505`.
- **Source:** [PostgreSQL, index uniqueness checks](https://www.postgresql.org/docs/current/index-unique-checks.html);
  [PostgreSQL, explicit locking, deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS).
  Cited, not fetched. Measured (#180 builder and reviewer,
  `src/server/teams/placement-races.integration.test.ts`).
- **Used by:** D-180-1, D-180-8

### R-180 · A locking clause with no `OF` list locks every joined row, and a waiting read sees the holder's change (measured)

- **Finding:** `SELECT … FROM a JOIN b … FOR KEY SHARE` with no `OF` list locks the
  returned row of each table, so an add's one statement holds its team and its session.
  Under READ COMMITTED, once the row it waited on commits, it returns the new version
  (an ended status) or, if the row was deleted, nothing (R-129). Measured in #180:
  holding either the team or the session `FOR UPDATE` parked the add in that statement,
  and it then read the ended session, or no team. Which of the two rows the statement
  locks first (the team, by the #180 reviewer's reading of range-table order) is not
  measured.
- **Source:** [PostgreSQL, SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
  [PostgreSQL, Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).
  Cited, not fetched. Measured (#180 builder and reviewer,
  `src/server/teams/placement-races.integration.test.ts`).
- **Used by:** D-180-3, D-180-5, D-180-6

### R-181 · A `visibility: hidden` `::after` holds layout, but no test or screen reader reads it

- **Finding:** `content: attr(data-hold)` on a `visibility: hidden` `::after` is laid out,
  so it holds its grid cell's height, but it is never painted. Generated content is in
  no `textContent`. Playwright 1.62.1's `getByText` and `hasText` read child nodes only,
  and its accessible names read `::before` and `::after` but skip `display: none` and
  `visibility: hidden`. On both engines the Saved line's aria snapshot listed only the
  visible words. Not checked with VoiceOver.
- **Source:** [CSS 2.1, `visibility`](https://www.w3.org/TR/CSS21/visufx.html#visibility);
  `node_modules/playwright-core/lib/coreBundle.js` (1.62.1: `elementText`, the pseudo
  content reader); measured (#136 verifier r2, aria snapshot on both projects)
- **Used by:** D-136-4, D-136-5

### R-182 · CI's Linux WebKit draws text in DejaVu Sans, which measures only from the same origin

- **Finding:** the app's `system-ui` stack falls back to DejaVu Sans on CI's Ubuntu
  runner. That face is wider than macOS's. At 32px with `px-3`, it set "Follow-up
  marked" a few px past one line. With `px-2` there is about 8px to spare. To measure in
  it locally, serve the font from the app's own origin. The CSP has `default-src 'self'`
  and no `font-src`, so a `data:` font is reported as a violation (Report-Only, D-122),
  and the E2E fails on any violation.
- **Source:** CI run 43375997037's screenshots; `src/server/http/security-headers.ts`;
  measured (#136 builder and verifier r0, with DejaVu Sans served from the app's origin)
- **Used by:** D-136-9

### R-183 · A `test.fail` test that fails as declared is `expected`, yet keeps its error

- **Finding:** in Playwright 1.62.1's HTML report, a `test.fail` test whose body fails has
  outcome `expected` and counts as passing. Its result is still `failed` with its error,
  and `test-results` keeps an `error-context.md`. With `trace: "retain-on-failure"` and
  `screenshot: "only-on-failure"`, nothing else is kept. So the error is listed beside
  the real failures and reads like one. In CI run 43375997037 the stats read 2
  unexpected, and `large-text.spec.ts:613` on mobile-webkit was `expected` ("covered").
  Extends R-107.
- **Source:** CI run 43375997037's HTML report (`report.json`, the test's JSON) and
  `test-results`; `playwright.config.ts`
- **Used by:** D-136-13

### R-184 · A sticky `bottom: 0` bar sits above its scroller's padding; `scroll-padding` counts from the scrollport

- **Finding:** in both engines, a `position: sticky; bottom: 0` child sticks inside the
  scroll container's padding. A sheet's bar therefore rests above the body's
  `env(safe-area-inset-bottom)` padding. `scroll-padding-bottom` is an inset from the
  scrollport's edge, so it must add that padding to clear the bar. Leaving it out, a
  field brought into view ends `inset - 16px` under the bar: 18px with a 34px home
  indicator.
- **Source:** [CSS Scroll Snap 1, `scroll-padding`](https://drafts.csswg.org/css-scroll-snap-1/#scroll-padding);
  #136 reviewer r2, not re-measured by the docs step
- **Used by:** D-136-3 (known limit), D-225-7, D-227-2, D-230-1

### R-185 · Vitest 5 clears every mock's calls before each test, including those made as a module loaded

- **Finding:** Vitest 5 turns `clearMocks` on by default (4.1.11: off). The runner calls
  `vi.clearAllMocks()` in `onBeforeTryTask`, before the test's `beforeEach` hooks. So
  calls recorded at a module's top level, in a setup file or in `beforeAll` are gone when
  the test reads them. Implementations stay (R-178). Setting `clearMocks: false` restores
  Vitest 4's behaviour.
- **Source:** [Vitest migration guide](https://vitest.dev/guide/migration), "`clearMocks`
  is Enabled by Default"; `vitest` 5.1.0 `dist/chunks/defaults.B1FCaFfh.js`
  (`clearMocks: true`; 4.1.11's `defaults.9aQKnqFk.js` has `false`), the `clearMocks`
  doc comment (`@default true`) in `dist/chunks/plugin.d.LRFSN46m.d.ts`, and
  `clearModuleMocks` in `dist/chunks/index.CZzC1gGg.js`, called before `beforeEach` in
  `dist/chunks/run.CjdgFZiW.js`
- **Used by:** D-187-1, D-187-2

### R-186 · Vitest 5's other breaking changes leave this repo's config as it is (measured)

- **Finding:** inline projects now extend the root config by default (`extends: true` was
  already set on all three) and share the root's Vite server unless they change Vite
  options. Coverage `include` and `exclude` now match paths relative to the root,
  without `contains`; the report still lists the same files as `git ls-files` minus the
  exclusions. Glob thresholds no longer inherit a top-level `perFile`, and none is set. A
  `vi.mock` or `vi.hoisted` below the top level now throws, and an unawaited async
  assertion or a late `expect.poll` fails; the suites pass, so none does either.
- **Source:** [Vitest migration guide](https://vitest.dev/guide/migration), the sections
  named; measured (#187 builder)
- **Used by:** D-187-4

### R-187 · ESLint 10 under eslint-config-next 16.4.5: three plugins' peers stop at 9, their rules still run

- **Finding:** eslint-config-next 16.4.5 nests eslint-plugin-react 7.37.5 (`eslint` peer
  `… || ^9.7`), eslint-plugin-import 2.32.0 (`… || ^9`) and eslint-plugin-jsx-a11y 6.10.2
  (`… || ^9`), so `npm ls eslint` marks 10.14.0 invalid. `npm ci` installs the lockfile
  anyway. The config wraps react and import in its own `fixupPluginRules`;
  eslint-plugin-react-hooks 7.1.1 takes `^10.0.0`. Their rules, and the repo's own, still
  report under 10.14.0. ESLint 10 drops eslintrc and Node below 20.19, and looks up the
  config from each linted file; the repo's flat `eslint.config.mjs` at the root needs no
  change.
- **Source:** each plugin's `package.json`; `eslint-config-next` `dist/index.js` and
  `dist/rule-context.js`; `npm ls eslint`; ESLint's "Migrate to v10.x" guide; measured
  (#187 builder and reviewer, linting probe code from stdin)
- **Used by:** D-187-4, D-187-5

### R-188 · Node floors: Vitest 5 22.12, ESLint 10 20.19, jsdom 31 22.22.2 or 24.15; the pinned `node:24-alpine` is 24.22.3

- **Finding:** `engines.node` is `^22.12.0 || ^24.0.0 || >=26.0.0` for vitest 5.1.0,
  `^20.19.0 || ^22.13.0 || >=24` for eslint 10.14.0 and `^22.22.2 || ^24.15.0 || >=26.0.0`
  for jsdom 31.0.0, the tightest. Node 20 is out. The Dockerfile's index digest
  `sha256:116b800c…` is Node 24.22.3, so the dev container meets jsdom's floor.
- **Source:** each package's `package.json`; the Vitest migration guide's prerequisites;
  docker-library/repo-info `repos/node/remote/24-alpine.md` at `3912a4a` (2026-11-12),
  whose `NODE_VERSION` for that digest is 24.22.3, read with `gh api`. The registry was
  not queried: a local hook blocks curl to it, as for R-147.
- **Used by:** D-187-6

### R-189 · jsdom 31's breaking changes need nothing here (measured)

- **Finding:** jsdom 31 moves canvas to `@napi-rs/canvas`, replaces its CSS engine
  (computed styles and serialisation can differ) and pauses parsing at blocking scripts.
  Focus now leaves an element that stops being focusable, asynchronously. Every
  component test passes unchanged. `@types/node` 24 needed no change to typecheck
  either. _Amended by R-199 (#208):_ that focus move made a sign-in test fail under load,
  and it showed a real focus drop in the form.
- **Source:** [jsdom 31.0.0 release notes](https://github.com/jsdom/jsdom/releases/tag/v31.0.0);
  measured (#187 builder: `npm test`, `npm run typecheck`)
- **Used by:** D-187-4

### R-190 · CI's trace of `large-text:369`: the session answered 1ms into the press on Add details

- **Finding:** in CI run 43375997037 on mobile-webkit, Playwright pressed Add details at
  (121, 460) from 262317.6 to 262352.8ms, with the page at scrollTop 664 and "Record a
  visit" on two lines. `/api/sessions/active` answered at 262318.7ms, the households
  at 262342.1ms, and the teams request went out at 262336.2ms, so the session was drawn
  before the release. The snapshot after the click, 46ms after the press began, has
  "Blk 123" on one line and scrollTop 634. Rendered with CI's CSS in DejaVu Sans, the
  header goes from 136 to 88px and the page from 1328 to 1280. The press point then
  falls about 4px under the button's foot if the header shrinks before the scroll is
  clamped, and stays on it in every other order. A clamp at once would leave 616, so 634
  fits only a release while the scroll was unclamped. The 18px between them came with a
  later answer, most likely the units' ("All units (0)" became "(38)"). macOS WebKit
  clamps in the same layout (builder), so it never missed here.
- **Source:** CI run 43375997037's trace (`0-trace.trace`, `0-trace.network`,
  snapshots `input@call@1354` and `after@call@1354`); measured with DejaVu Sans served
  from the app's origin (R-182) by the #181 builder, reviewer r0 and verifier r0
- **Used by:** D-181-7

### R-191 · Playwright checks a click's hit target only at its first pointer event

- **Finding:** `setupHitTargetInterceptor` sets its result only while it is still
  undefined, on the first trusted pointer event of the action that has a point. Later
  events, the release and the click among them, are blocked only if that first check
  failed. So an element that moves between press and release takes neither the release
  nor the click, and the action still reports success.
- **Source:** `node_modules/playwright-core/lib/coreBundle.js`, `setupHitTargetInterceptor`
  (1.65.0, read by #181 reviewer r0 and the docs step). CI's run used 1.62.1, not
  re-read.
- **Used by:** D-181-7

### R-192 · At the 32px root, "Record a visit" needs two lines in DejaVu Sans, and in any font at 320px

- **Finding:** set in `text-title` bold in the inline header's title column, "Record a
  visit" fits one line in the macOS system font at 390 and 393px. It takes two in
  DejaVu Sans at 390px (CI's iPhone 13) and in both fonts at 320px. Held to one line it
  reads "Recor…" in DejaVu at 320px and "Record a…" in the system font at 320px or in
  DejaVu at 390px. The header is 88px in every state once the stand-in is one line.
- **Source:** measured (#181 builder renders at 320 and 390px in both fonts; verifier r0
  on both projects, with DejaVu Sans served from the app's origin, R-182)
- **Used by:** D-181-6, D-181-8

### R-193 · CI's E2E job runs on Ubuntu 26.04; Playwright's browsers need glibc, and its Docker guide recommends `--ipc=host` and `--init`

- **Finding:** CI's `ubuntu-latest` is Ubuntu 26.04. The E2E jobs of run 43375997037
  (#181's failure), 43596084911 and 43627225097 (the last green run on `main`, Node
  24.22.2) all report `Image: ubuntu-26.04`. Playwright's Docker guide supports Ubuntu
  26.04, 24.04 and 22.04, and not Alpine or any other musl distribution. It recommends
  `--ipc=host`, without which Chromium can run out of memory and crash, and `--init`,
  so PID 1 reaps zombie processes. Run as root, Chromium's sandbox is off, which matters
  only for untrusted sites. After `npx playwright install --with-deps chromium webkit`
  and `fonts-dejavu-core`, fontconfig resolves `sans-serif` to DejaVu Sans, as on CI
  (R-182). On an arm64 Mac (Docker Desktop with 8 CPUs and 12 GB), the whole suite
  passed natively on arm64: 183 passed and 7 skipped, as on macOS at b0976bc, in
  5.3 minutes on 24.04 and 5.4 on 26.04. The first image build plus the run took 8m17s
  and 7m29s. Under Docker Desktop's amd64 emulation (Rosetta), GNU tar in the 26.04
  image could not create a file or directory (`Function not implemented`), while
  `docker cp` of the same archive works.
- **Source:** the runs' job logs (`gh run view --log`, "Runner Image");
  playwright.dev/docs/docker (read 2026-11-16); measured (#201)
- **Used by:** D-201-1, D-201-4

### R-194 · In the e2e container's Linux WebKit, `:376` passes 40 runs with and without #199's fix, and `:845` fails without it

- **Finding:** in the e2e container (R-193, Ubuntu 26.04, DejaVu Sans),
  `large-text.spec.ts:376 --project=mobile-webkit --repeat-each=40` passed 40 of 40 on
  `main` at b0976bc (#199's fix), natively on arm64 in 3.6 minutes and under amd64
  emulation, CI's architecture, in 10.2. It also passed 40 of 40 on arm64 at 13215e7,
  before the fix. So the forty runs #181's acceptance asks for cannot tell the fix from
  its absence here: the miss in run 43375997037 needed the session's answer to land
  within the press (R-190). `:845`, which holds the session's answer and measures the
  unit field, failed on both projects with `standIn={false}` on b0976bc, the field
  moving from y 386 to 338, the same numbers as on macOS (D-181-8). With the fix it
  passed on both in the whole-suite runs.
- **Source:** measured (#201, `npm run test:e2e:linux`, 2026-11-16)
- **Used by:** D-181 known limits, D-201-1

### R-195 · A `findBy` polls its whole container on the main thread, so a slow query holds up the render it waits for (measured)

- **Finding:** `findBy*` is `waitFor` around a `getBy*` query. By default it gives up
  after 1000 ms (`asyncUtilTimeout`). It runs the query every 50 ms, and again on every
  mutation in its container, using a `MutationObserver` on the subtree. Each query runs
  on the main thread, so a slow one holds up whatever render is waiting. From
  `within(el)`, it watches and queries only `el`. On the block screen with more than 100
  rows, under load (builder's diagnostic copy of the test), a whole-page
  `findByRole("tab")` took up to about 250 ms a query. The tab landed after a median of
  about 400 ms and as late as 949 ms. Scoped to the tablist, at the same load, each query
  took at most 70 ms and the tab landed by 293 ms.
- **Source:** `node_modules/@testing-library/dom/dist/wait-for.js`, `config.js` and
  `query-helpers.js` (`makeFindQuery`), 10.4.1, read by the #192 docs step. Measured by
  the #192 builder: per-poll timings in `block-screen.test.tsx`, 16 to 24 runs per
  variant.
- **Used by:** D-192-2

### R-196 · Each browser words a fetch with no answer its own way, and a worker's network-only route rejects the same (measured)

- **Finding:** the Fetch Standard rejects `fetch()` with a `TypeError` on a network error
  and leaves its message to the browser. With no answer, the message read "Failed to
  fetch" in Chromium and "Load failed" in WebKit, both for a request aborted by a route
  and for a context taken offline with the worker blocked. In Chromium with the service
  worker in charge, an API request rejected the same way, "Failed to fetch": the API
  route is network-only, and the worker's fallback answers navigations only. Firefox's
  "NetworkError when attempting to fetch resource." was not measured; the project runs
  no Firefox. Extends R-36.
- **Source:** [Fetch Standard, `fetch()` method](https://fetch.spec.whatwg.org/#fetch-method);
  measured (#194 verifier, Pixel 5 on Chromium and iPhone 13 on WebKit, production build)
- **Used by:** D-194-2

### R-198 · A tie's order follows the plan, which an `ANALYZE` can change (measured)

- **Finding:** rows equal on every `ORDER BY` key come back in an
  implementation-dependent order, so a tie can read differently on another day of the
  same database. Measured on PostgreSQL 17.11 in #207: three notes stored at one
  `created_at` (ids 2, 3, 1) and read by `listFollowUpsFor` without the id came back in
  the order stored, and reversed (1, 3, 2) after `ANALYZE follow_ups` in the same test;
  in psql, a plan that hashed `follow_ups` for the author join also reversed a tie. On
  `door_to_door_test_193`, reused for many runs, #160's two tied notes came back
  reversed in 8 runs of 8, and in the order stored on a new database in 3 of 3. The
  builder could not reproduce that on `door_to_door_test_207`, as it was or after
  `ANALYZE`. So a test of a tie needs ids whose order is neither the order stored nor
  its reverse.
- **Source:** [PostgreSQL, SELECT, ORDER BY](https://www.postgresql.org/docs/current/sql-select.html#SQL-ORDERBY).
  Cited, not fetched. Measured (#207: the issue, the builder and the reviewer).
- **Used by:** D-207-1, D-207-5, D-207-7, D-212-1, D-212-5

### R-199 · jsdom 31 moves focus off a control that became disabled, at its next rendering update

- **Finding:** jsdom 31 runs the HTML focus fixup. A DOM change clears the style cache,
  and a clear while an element is focused requests a fixup (`_clearStyleCache`). The
  fixup runs in a 60 Hz `setInterval`, after the animation-frame callbacks of the same
  tick. If the focused element is no longer focusable, disabled for one, focus moves to
  the document, so `activeElement` is `<body>`. A test that reads focus while a control
  stays disabled past a frame finds it on `<body>`, as a browser does (R-200). Removing
  the focused element still moves focus at once. On main, #208's test flow repeated 200
  times beside a full `npm test` failed 7 times, each from `focusFixup`. This supersedes
  R-43, which held for jsdom 30.0.1 only, and amends R-189.
- **Source:** jsdom 31.0.0, `living/nodes/Document-impl.js:288-293`,
  `browser/Window.js:628-637` and `living/helpers/focusing.js:212`, read by the #208
  builder and both reviewers. Measured by the #208 builder.
- **Used by:** D-208-1, D-208-6, D-214-7

### R-200 · On the phone profiles, a press on a disabled sign-in button ends with focus on the page

- **Finding:** the builder measured a refused sign-in before #208's fix:
  - On Pixel 5 (Chromium), a tap, click or keyboard press on Sign in, or a tap or click
    on Sign in with Google, focused the button. The button lost focus to `<body>` while
    disabled, and focus stayed there.
  - On iPhone 13 (WebKit), a tap or click focused no button, so focus was on `<body>`
    from the start. A keyboard press on Sign in ended on `<body>`.
  - On both, Go in Password kept focus in Password.

  After the fix, Pixel 5 ended on the pressed button, with a `:focus-visible` ring only
  after a keyboard press. iPhone 13 ended on Sign in after a keyboard press, and on
  `<body>` after a tap or click. So D-151-7's "focus stays on Sign in" never held for a
  real refusal before #208. Reviewer r1 reproduced the drop and the refocus on a static
  page in both engines.

- **Source:** Playwright on a production build with the `e2e` config, on the Pixel 5
  and iPhone 13 projects, run natively on macOS by the #208 builder. It was a manual
  probe, not a spec. _Amended by #214:_ `e2e/auth.spec.ts` now pins the refocus after a
  key press on both projects (D-214-6), and R-213 found the same drop elsewhere.
- **Used by:** D-208-1, D-208-3, D-208-5, D-208-8 (superseded by D-214-6)

### R-201 · The Saved line's widest pair is 18.71 rems in the system face and 20.68 in DejaVu Sans (measured)

- **Finding:** at 16px, the pair is "Saved #12-1234A.", the line's 8px gap and the offer:

  | Offer                    | System face, both engines | DejaVu Sans                                |
  | ------------------------ | ------------------------- | ------------------------------------------ |
  | "Suggest a return visit" | 18.71 rem (299.3px)       | 20.68 rem (330.8px) WebKit, 20.66 Chromium |
  | "Add to follow-up list"  | 18.12 rem                 | 19.87 rem WebKit, 19.85 Chromium           |

  The line's content box measures:
  - 21.44 rems on the Pixel 5 and 21.25 on the iPhone 13 at 16px;
  - 20.0 and 19.82 rems at 17px, the iPhone's default (R-62);
  - 310px (19.38 rems) on a 360px phone at 16px;
  - 322px (18.94 rems) on a 375pt iPhone at 17px;
  - 270px (16.9 rems) on a 320px phone at 16px.

  So a 21-rem threshold, sized for DejaVu, held a blank row at the default size on
  360px phones and on 375pt and 390pt iPhones, where the pair fits in the phone's own
  face. In the system face, a line of 18.75 rems or wider always fits the pair. At 16px,
  only a screen under about 350px wide, such as a 320px one, is narrower than that.

- **Source:** measured (#196 builder, Chromium and WebKit, with DejaVu Sans served from
  a test origin and from the app's origin, R-182; verifier r0 and r1, at 5 widths and 7
  text sizes)
- **Used by:** D-196-2, D-196-15

### R-202 · Below a 16px root, a container query measures in a smaller rem than the text (measured)

- **Finding:** a container query's `rem` is the root's font size (R-75), while the text
  follows `--reader-rem`, which is `clamp(16px, 1rem, 32px)`. The two agree only from a
  16px root to 32px.
  - At iOS's 14px body size (R-62) on a 320pt screen, the Saved line's 270px content box
    measures 19.29 rems. It takes the wide layout, though its text is 16px and the pair
    needs 299px.
  - The offer then drops the unit field 22px when it turns up, on both engines, as on
    main.
  - Above a 32px root, the query measures fewer rems than the text needs, which errs
    toward the held row. This follows from the clamp and was not measured.

  Amends R-75, whose "the reader's text size" holds only within the clamp.

- **Source:** `src/app/globals.css` (`--reader-rem`); measured (#196 verifier r1, the
  `320-14px` case on both projects)
- **Used by:** D-196-2 (known limit)

### R-203 · An element's client rects are its boxes; a Range's are the lines of its text

- **Finding:** `Element.getClientRects()` returns one rect per box fragment. An inline
  element over two lines gives two. A blockified one, such as a flex item or one whose
  display changed, gives one, whatever its text does. `Range.getClientRects()` over the
  element's contents also includes a rect for each line fragment of the text in it,
  whatever the element's display. So the distinct tops of a Range's rects count the
  lines a word is drawn on. No bite reached this step: each failed earlier, on the
  element count.
- **Source:** [CSSOM View, `getClientRects()`](https://drafts.csswg.org/cssom-view/#dom-element-getclientrects)
  and [`Range.getClientRects()`](https://drafts.csswg.org/cssom-view/#dom-range-getclientrects).
  Cited, not fetched.
- **Used by:** D-196-7

### R-204 · A focused box inside its label tile: on WebKit only the box comes into view (measured)

- **Finding:** at 32px in Add households, the last box was focused while the sheet body
  called `scrollIntoView({ block: "nearest" })` on the input. On WebKit the label tile's
  foot ended 64px under the docked Add, both on main and with `wholeControl` reverted.
  On Chromium the tile cleared the bar either way, by the browser's own focus scroll, so
  the check bites on WebKit only. Scrolling the tile instead, it clears the bar by 16px
  on WebKit and 17px on Chromium.
- **Source:** measured (#196 builder; verifier r0 to r2, iPhone 13 and Pixel 5 profiles,
  production builds of main 17e935b and the branch)
- **Used by:** D-196-5, D-196-8

### R-205 · What of a unit's history shows above the docked Save, with the panel last in the form (measured)

- **Finding:** at `#05-123` in a door-to-door session, unscrolled, once the history
  lands, this is how much of it is above the docked Save:

  | Phone, root     | Main (panel above the picker) | Panel last (f1d02d3)      | With the line (5d85916)        |
  | --------------- | ----------------------------- | ------------------------- | ------------------------------ |
  | iPhone 13, 16px | 236px                         | 12px, the card's top edge | the whole line                 |
  | iPhone 13, 17px | 222px                         | 0px                       | the whole line                 |
  | Pixel 5, 16px   | 299px                         | 75px, its first line      | the whole line, and 31px of it |
  | Pixel 5, 17px   | 285px                         | 47px                      | the whole line, and 3px of it  |

  On main, the history held the household's name, "On the follow-up list" and an
  Overdue note. As it landed at 32px, Medium dropped 1,494px (Chromium) and 1,582px
  (WebKit) on main, and 0px on the branch. With the line, all four interest tiles are
  above Save on an iPhone 13 at 16px and 17px once the history lands.

- **Source:** measured (#196 verifier r0, r2 and fix-r1, production builds of main
  17e935b, f1d02d3 and 5d85916)
- **Used by:** D-196-4, D-196-18

### R-206 · The history line's longest summary is one row from 360px to 393px at 16px and 17px, except 360px at 17px (measured)

- **Finding:** "On the follow-up list · Overdue · 99 visits · See history", as wide as
  it is held:

  | Hold                                | 16px    | 17px    |
  | ----------------------------------- | ------- | ------- |
  | Medium, tabular figures (5d85916)   | 318.0px | 334.7px |
  | The same in DejaVu Sans             | 330.7px | 351.4px |
  | Semibold, "99 visits"               | 324.7px | 341.8px |
  | Semibold, "No visits yet" (775137c) | 347.3px | 365.5px |

  The line has 328px at 360px and 16px, 326px at 360px and 17px, 343px and 341px at
  375pt, 356px at 390pt and 17px, 359px at 393px and 17px, and 288px at 320px. Page
  gutters grow with the text, so a 375pt iPhone has 341px at 17px, not 343px.
  - In the system face the hold is one 44px row at every width from 360px to 393px at
    16px and 17px, except 360px at 17px, where its words take two rows too.
  - In DejaVu it is two rows at 360px and 16px, where its words take one, and at 375pt
    and 17px. A Pixel 5 at 17px has 7.6px to spare.
  - "100 visits" is 7.8px wider at 16px and 8.2px at 17px. Tabular figures make every
    two-figure count as wide as "99 visits".
  - After Save and next, at a new unit, Medium shows 4 of its 60px above the docked
    Save on an iPhone 13 at 17px, and 4 of 56px on a 360×640 screen at 16px. Before the
    line it showed 48px at both. A Pixel 5 shows all of it. With no line at a new unit
    (30853ff), all of Low, Medium and High is above Save on an iPhone 13 at 16px and
    17px, and 10 to 11px of them at 360×640 and 17px, where main showed none.

- **Source:** measured (#196 builder r3 and r4; verifier fix-r0 and fix-r1, both
  engines, production builds of f1d02d3, 6be1c93, 5d85916 and 30853ff; DejaVu Sans from
  its font file). Roboto was not measured.
- **Used by:** D-196-18, D-196-22, D-196-29 (Known limits)

### R-207 · On WebKit, a tap on a button inside a focusable panel focuses the panel, and the page scrolls to it

- **Finding:** Safari does not focus a `<button>` on a click or tap, so focus goes to
  its nearest focusable ancestor. With the history panel at `tabIndex -1` (775137c), a
  tap on a button in it focused the panel and scrolled the page to it, so "Could not
  load earlier visits." sat under the docked Save. `record-visit.spec.ts:998` failed on
  WebKit in both full runs, and passed once only the panel's first line was focusable
  (6be1c93).
- **Source:** measured (#196 builder, 775137c and 6be1c93);
  [MDN, `<button>`: clicking and focus](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#clicking_and_focus).
  Cited, not fetched.
- **Used by:** D-196-24

### R-208 · A word held whole in an inline-block: where it breaks, what it draws, and how its spill is seen

- **Finding:**
  - An inline-block with `max-width: 100%` and `overflow-wrap: break-word` goes whole
    onto the next line where it fits on one, and wraps inside, at its hyphen first, only
    where it alone is wider than its line. Nowrap ran "follow-ups?" 16px out of the
    "What are follow-ups?" hint at 320px and 32px in DejaVu Sans, on both engines.
    `whole-word` leaves it 0px past. The system face has 18px to spare there.
  - Text decoration is not propagated into an atomic inline such as an inline-block, so
    the word must inherit its own underline.
  - An inline element's box goes wherever its words go, so its words never spill past
    it. Measured against the nearest non-inline box, the nowrap spill is caught; the old
    measure passed it.
  - Among words in another weight, an action on its baseline made WebKit's line 1/64px
    taller than its held words at 32px. Aligned to the top, it is not.
- **Source:** measured (#196 builder, 775137c; verifier fix-r0 and fix-r1, with DejaVu
  Sans injected); [CSS Text Decoration 3, line decoration](https://drafts.csswg.org/css-text-decor-3/#line-decoration).
  Cited, not fetched.
- **Used by:** D-196-23, D-196-26, D-196-28

### R-209 · A block's units land before a member can type a unit, except on weak signal (measured)

- **Finding:** fresh block opens, JS cached, service worker blocked, 3 runs each; ms
  from the start of navigation. Typing `#05-123` began the moment the unit field existed.

  | Network                      | Units read land | Last key, 150ms a key | Last key, 250ms a key |
  | ---------------------------- | --------------- | --------------------- | --------------------- |
  | Local, Chromium              | 62–205          | 988–1003              | 1597–1602             |
  | Local, WebKit                | 70–224          | 1014–1030             | 1602–1618             |
  | 4G-like: 100ms RTT, 9 Mbps   | 264–280         | 1087–1093             | 1694–1707             |
  | 3G-like: 300ms RTT, 1.6 Mbps | 760–783         | 1310–1314             | 1902–1918             |
  | Weak: 800ms RTT, 400 kbps    | 2166–2194       | 1874–1935             | 2469–2521             |

  The line came 2 to 6ms after the last key in every cell but one: on weak signal at
  150ms a key, the units landed after the last key, and the line came 259 to 296ms after
  it.

  - The read starts once the page is live, and is one 3.5 KB page for the seeded block
    of 6 units. Each further 100 units is another round trip.
  - Not measured: a block of 100 or more units, client-side navigation from the Session
    screen, a cold cache, and WebKit throttled.

- **Source:** measured (#196 builder r4, production build; Chromium throttled through
  CDP).
- **Used by:** D-196-29 (Known limits), D-200-3 (Known limits)

### R-210 · Chrome holds an answer carrying `Clear-Site-Data: "cache"` until its whole HTTP cache is cleared (measured)

- **Finding:** in Playwright's Chromium with a persistent profile, the production image's
  sign-out `POST` (which then sent `"cache"`) was answered after 44ms with an empty HTTP
  cache, and after 4,079ms once another origin had filled the cache with 4,000 cacheable
  100 KB files (400 MB). The page reached `/sign-in` 139ms and 4,160ms after the tap. So
  the wait grows with the whole cache, every site's entries included, not this origin's
  share. Real profiles hold several GB. A fresh Playwright profile has an empty cache,
  which is why the E2E suite never saw it. Every signed-in page, its RSC payload and every
  API answer was `no-store` on the same build, so the cache held nothing signed-in. With
  the header removed (#218's branch, the same 400 MB profile), the answer came after
  11ms and the page reached `/sign-in` 106ms after the tap.
- **Source:** measured (#218, 2026-11-18; production image against postgres:17-alpine on
  a private Docker network).
- **Used by:** D-218-1

### R-211 · A bounded sort orders a tie by its bound, so two pages can disagree (measured)

- **Finding:** with `LIMIT` and `OFFSET`, PostgreSQL 17.11 sorts by top-N heapsort once
  the rows the filter matches exceed twice the bound (`offset + limit`), and by quicksort
  below that (`EXPLAIN ANALYZE`: 401 matched rows at bound 200 used the heap, 400 used
  quicksort). The heap orders a tie by its bound, so a tie at a page edge can read
  differently on the two pages. What triggers it is how many rows match, not how long the
  tie is. Reviewer, temp table: 500 rows at distinct instants but five (ids 98 to 102)
  tied across the first edge, read 100 a page by the timestamp alone. Id 100 came on pages
  1 and 2 and id 102 on neither (499 distinct); with `id desc` added, all 500 once. With
  250 rows and a three-row tie at the same edge nothing was lost: page 2 (bound 200) used
  quicksort. So a drop needs both pages on the heap: for the export, 100 a page, a tie at
  the edge after page _k_ needs more than 200(_k_ + 1) matching records. The builder's
  psql case (30 rows at one instant, five a page) also used the heap on both pages, and
  repeated id 1 and dropped id 6.
- **Source:** measured (#212: builder, reviewer, docs agent; PostgreSQL 17.11).
  [PostgreSQL, LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
  warns that without an `ORDER BY` that fixes the order, offset pages are unpredictable.
  Cited, not fetched.
- **Used by:** D-212-1

### R-212 · `nearest` lines up the top of a box taller than its room, leaving its foot under the nav (measured)

- **Finding:** with `scrollIntoView({ block: "nearest" })`, a box taller than the room
  between its scroll margins, whose foot is below the view, is aligned by its top, so
  its foot stays under the nav. The mirror of R-89. At 32px a Sessions row's block of
  title, badges, Start and its alert was 608 to 774px tall, against 607px of room above
  the nav on a Pixel 5 and 544px on an iPhone 13, and the alert ended 61 to 460px under
  the nav. Calling `nearest` on the alert and then on the button brings the alert's foot
  onto the nav, then moves the page back only if the button's top went past the top
  margin. On both phones every alert then ended exactly on the nav or the floating
  banner.
- **Source:** [CSSOM View, scroll an element into view](https://drafts.csswg.org/cssom-view/#scroll-an-element-into-view);
  measured (#213 verifier r0 and r1, Pixel 5 on Chromium and iPhone 13 on WebKit).
- **Used by:** D-213-1, D-232-7

### R-213 · A failed press on a busy-disabled button ends with focus on the page, wherever measured (measured)

- **Finding:** at 679fa56, before #214's fix, each refusal was held until focus had been
  read, then failed. Each cell reads "where the press left focus → where focus was after
  the refusal":

  | Place                                | Pixel 5: tap, click, key | iPhone 13: tap, click | iPhone 13: key  |
  | ------------------------------------ | ------------------------ | --------------------- | --------------- |
  | Sign in (#211's fix)                 | button → button          | no button → body      | button → button |
  | Account's Sign out                   | button → body            | no button → body      | button → body   |
  | Record form's Save (session unknown) | button → body            | no button → body      | button → body   |
  | Amend sheet's Save changes           | button → body            | no button → panel     | button → body   |
  | Start session on `/admin/sessions`   | button → body            | no button → body      | button → body   |
  | Make an admin on `/admin/team`       | button → body            | no button → body      | button → body   |
  - Chromium focuses the button on every press, WebKit only on a key press. Disabled, the
    button loses focus to `<body>`, and the refusal leaves it there. Inside a sheet, a
    WebKit tap leaves focus on the panel, inside the modal; `<body>` is outside it.
  - The drop's timing varies. Sign in sometimes still had focus three frames after it
    was disabled, while every other place had lost it. A bare button disabled by hand
    lost it within five frames on both engines. So a test must wait for the drop.
  - After the fix (verifier r0, r1), every place in scope ended on its button after a
    press that had focused it, and focus the member had moved stayed put. On End's,
    Deactivate's and Sign out anyway's confirms, the hook's focus landed on a still-inert
    button and did nothing; D-90-9's return put focus there. A Pixel 5 tap leaves no
    `:focus-visible` ring, a key press does.

- **Source:** Playwright 1.65 on a production build with the `e2e` config, Pixel 5
  (Chromium) and iPhone 13 (WebKit), run natively with service workers blocked: two full
  runs of 36 readings, every "after" reading the same (#214 planner). The verifier's
  device passes, 67 cases a phone. Extends R-200 from sign-in to the rest of the app.
- **Used by:** D-214-1, D-214-2, D-214-4, D-214-5, D-214-6

### R-214 · A Vitest fake clock can leave jsdom 31 drawing no frame and moving no focus for the rest of a file (measured)

- **Finding:** `vi.useFakeTimers()` with nothing passed fakes every timer but `nextTick`
  and `queueMicrotask`, `setInterval` included. jsdom 31 runs animation-frame callbacks
  and its focus fixup on one Node `setInterval`, started when first needed and cleared
  only from its own callback once idle (R-199). Started while the fake clock is on, it is
  a fake interval: after `vi.useRealTimers()` it never fires and is never cleared, and
  jsdom starts no other while it holds one. For the rest of the test file no frame is
  drawn and no disabled control loses focus, so `nextFrame()` (D-208-6) waits forever and
  a focus test asserts nothing real. Faking only `setTimeout` and `clearTimeout` leaves
  the interval real.
- **Source:** jsdom 31.0.0 `lib/jsdom/browser/Window.js:620-645`
  (`scheduleRenderingUpdate`, `stopRenderingUpdatesIfIdle`); Vitest 5.1.0's default
  `toFake` (`dist/chunks/index.CZzC1gGg.js:6648-6650`). Measured by the #214 builder
  (9828c3c): a focus test after `record-visit-form.test.tsx`'s stalled-outing test hung
  on its frame.
- **Used by:** D-214-10

### R-215 · A sheet's focus scroll moved its form by the bar's height when the bar's button took focus, even with `preventScroll` (measured)

- **Finding:** `focus({ preventScroll: true })` stops the browser's own scroll, but the
  sheet body's `onFocus` still ran `scrollIntoView({ block: "nearest" })` on the target.
  The body's scroll padding (`scroll-clear-sheet-actions`) counts the sticky bar as
  covered, so `nearest` on a control inside the bar scrolled the content by up to the
  bar's height. At 32px a bare `save.focus({ preventScroll: true })` in the amend sheet
  moved its scroller from 200 to 284 on both engines. `overflow-anchor: none` changed
  nothing, and stopping `focusin` at the button kept it at 200. With #214's refocus the
  amend form moved 84px at 32px on both phones, and 61px on an iPhone with a keyboard at
  the default text, which hid the failure under the header. With the bar skipped
  (99c37d0), all 16 A/B cases a phone read the same with and without the refocus. In
  "Suggest a return visit" a tap or Tab onto Send moved nothing, and the date field still
  came clear of the bar.
- **Source:** measured (#214 verifier r0 and r1, production build, Pixel 5 on Chromium
  and iPhone 13 on WebKit).
- **Used by:** D-214-9

### R-216 · Auth.js posts a credentials sign-in with a query string

- **Finding:** `signIn` from `next-auth/react` posts a credentials sign-in to
  `{basePath}/callback/credentials?{params}`, so the URL ends in `?` even with no
  params. A Playwright route glob `**/api/auth/callback/credentials` does not match it;
  a predicate on `url.pathname` does.
- **Source:** `next-auth` 5.0.0-beta.32 `react.js:151-153`; found by the #214 builder.
- **Used by:** D-214-6

### R-217 · Where the amend sheet draws its failure decides how far the form moves to show it (measured)

- **Finding:** scrolled to with `nearest`, an alert at the top of the form pulls it back
  by up to the form's whole length; beside Save, by the alert's height plus 16px. How far
  Notes moved, Pixel 5 / iPhone 13:

  | Case                              | At the top  | Beside Save           |
  | --------------------------------- | ----------- | --------------------- |
  | default, at the top (form fits)   | 0 / 45      | 82 / 82 (panel grows) |
  | default, details open, at Notes   | 259 / 313   | 82 / 82               |
  | default, details open, at the top | 82 / 82     | 267 / 321             |
  | 32px, at Notes                    | 903 / 957   | 242 / 242             |
  | 32px, picker mid-form             | 594 / 620   | 551 / 579             |
  | 32px, details open, at Notes      | 1455 / 1509 | 242 / 242             |

  Beside Save, Save changes moved 0px in all 14 cases once the form had no bottom
  padding. With `py-4` it dropped 16px, or 32px at 32px text: a sticky bar stays inside
  its form, so at the end of the scroll the form's bottom padding showed under it.

- **Source:** measured (#225 builder, production build, Pixel 5 on Chromium and iPhone 13
  on WebKit; the top case simulated with an alert-sized copy at the top of the form). The
  built layout was confirmed by the #225 verifier.
- **Used by:** D-225-1, D-225-6, D-232-1

### R-218 · A target's `scroll-margin` adds to its scroller's `scroll-padding` in `scrollIntoView` (measured)

- **Finding:** with a 34px inset and details open, the amend sheet's failure ended 17.6px
  under the bar (17.7px on Chromium), as R-184 predicts. With
  `scroll-margin-bottom: env(safe-area-inset-bottom)` on the alert it ends 16px above, on
  both engines. The margin computes to 0 without an inset. No Playwright device draws an
  inset; two ways of simulating one gave identical boxes. One serves the stylesheet with
  every `env(safe-area-inset-bottom)` rewritten to 34px, with service workers blocked so
  `page.route` sees the CSS. The other is Chromium's CDP
  `Emulation.setSafeAreaInsetsOverride`. Re-measures R-184's shortfall.
- **Source:** [CSS Scroll Snap 1, `scroll-margin`](https://drafts.csswg.org/css-scroll-snap-1/#scroll-margin);
  measured (#225 verifier r0 and r1, iPhone 13 at 390x844 on WebKit, 393x851 on Chromium)
- **Used by:** D-225-7, D-230-1, D-230-3, D-230-4

### R-219 · React draws two updates made outside an event in one render, and an urgent update before a transition (measured)

- **Finding:** in React 18 and later, state updates made outside a React event, after
  an `await` or in a promise callback, are batched and drawn together in a later task.
  So an update made one `await` on an already-settled promise after another, a
  microtask later, lands in the same render. An update inside `startTransition` is drawn
  after an urgent one made beside it, so a `setState` outside the transition commits
  first, while the transition's state still holds the old value (R-151 on the lanes).
  Measured in #221: with `refused()` moved out of its transition, the record form's Undo
  and Show earlier visits tests fail, as the hook focuses a button still disabled. Join's
  `refused()`, one settled `await` after `change()`'s `finally`, gives focus back, and
  its test fails without it.
- **Source:** [React 18: automatic batching](https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching),
  [`startTransition`](https://react.dev/reference/react/startTransition); react-dom
  19.3.1 in this repo; measured by the #221 builder, reviewer r1 and verifier (mutations
  RV2, HH1, OT1).
- **Used by:** D-221-5, D-221-6, D-221-15, D-234-1

### R-220 · React keeps an unkeyed element in its slot as its props change, and a focused button keeps focus as its label does (measured)

- **Finding:** React matches an element by its type and place, and by `key` where one is
  given. The same component in the same place with the same key, or none, is updated in
  place, keeping its state and its DOM node; a changed key mounts a new one, and the
  browser drops focus from the removed node to the page. State that must change with a
  prop can be set while rendering by comparing it with the previous value kept in state:
  React draws the component again before its children and before committing. Updates set
  in one `startTransition`, or in one continuation after an `await`, are batched into one
  render. Measured: on a Pixel 5 (Chromium) and an iPhone 13 (WebKit), a focused
  `<button>` whose label and class change (End to Reopen, Start or Reopen to End) keeps
  focus, in 24 of 24 key-press cases.
- **Source:** [React, Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state);
  [React, Adjusting some state when a prop changes](https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes);
  [React 18, automatic batching](https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching);
  measured (#226 verifier r0 to r2, production build).
- **Used by:** D-226-2, D-226-8, D-226-9

### R-221 · Typing in a sheet's textarea scrolls the body to the caret, within its scroll padding, not to the box (measured)

- **Finding:** on Chromium and WebKit, each keystroke in a focused `<textarea>` scrolls
  the sheet's body only far enough to put the caret inside its `scroll-padding` (the bar
  plus 16px, D-136-3). So the line being typed stays clear of the bar while the box's
  foot need not. At 32px on an iPhone 13 in the browser, Suggest a return visit's 226px
  note has 199.4px of room above Send. After focus its foot is 21.6px under the bar
  (Shift+Tab) or 42.6px (Tab, tap). Once the text reaches its third or fourth row the
  body scrolls 58px and the foot ends 15.4px clear. The caret was never under the bar
  (0 of 750 keystrokes), at worst 15.5px above. On a Pixel 5 the box fits, 10.9px above.
  With a 34px inset the same scroll stops short by R-184's shortfall: at 28 and 32px the
  caret was under the bar in 81 of 150 keystrokes on both engines, by up to 17.5px,
  though the box fits (226px in 318.4px). With `env(safe-area-inset-bottom)` added to
  the body's scroll padding (#230's fix) it stayed at least 16.5px above. A three-row box
  (178px, forced in CSS) ended 5.4px above the bar in the browser after Tab or a tap, and
  installed still had 95 of 150 under.
- **Source:** measured (#227 planner, production build at 4a79e6e, Pixel 5 on Chromium at
  393x727 and iPhone 13 on WebKit at 390x664; the default text and 24, 28 and 32px;
  focus by Tab, Shift+Tab from Send and a tap). Installed was simulated at 390x844 and
  393x851 with every `env(safe-area-inset-bottom)` rewritten to 34px, as in R-218. Each
  case typed a wrapping 69-character sentence, then six lines with Enter, 150
  keystrokes. Two frames after each, the caret's place was read from a mirror of the
  textarea, which matched its `scrollHeight` to 0px whenever the text overflowed.
  Re-measures R-184's shortfall while typing.
- **Used by:** D-227-1, D-227-2, D-227-3, D-230-1

### R-222 · App Router remounts a page when its dynamic segment's value changes, and React ignores a state set after unmount (read)

- **Finding:** in the browser, Next's layout router keys each segment's subtree by its
  cache key, which for a dynamic segment holds the param's value (`id|<value>|d`). So
  going from one `/admin/sessions/[id]` to another mounts a new page and unmounts the old
  one, running its effects' cleanups. Only with `cacheComponents` on is an old segment
  kept, hidden in `<Activity>`; it is off here. Since React 18, a `setState` on an
  unmounted component does nothing and no longer warns.
- **Source:** next 16.4.5, `dist/client/components/layout-router.js` (each segment's
  `TemplateContext.Provider` keyed by `stateKey`), `create-segment-key.browser.js` and
  `bfcache-state-manager.js` (one entry without `cacheComponents`); Next's
  `template.md` ("They remount when that segment (including its dynamic params)
  changes"); [React 18 upgrade guide, other notable changes](https://react.dev/blog/2022/03/08/react-18-upgrade-guide#other-notable-changes);
  react-dom 19.3.1, whose only such warning left is for a component not yet mounted.
  Read, not measured (#234 docs).
- **Used by:** D-234-3

### R-223 · Focus scrolls a field out of view toward the middle, and WebKit did so for a date input even with `preventScroll` (measured)

- **Finding:** on Chromium and WebKit, `focus()` on a field below a sheet body's visible
  part scrolls it toward the middle of the scrollport before the sheet's own `nearest`
  focus scroll runs. In Suggest a return visit at 32px on a simulated installed phone
  that reached the end of the scroll, where "Go back by (optional)" rests 16px above the
  bar whatever the scroll padding, so a focus-based check passed with #230's fix
  reverted. With `focus({ preventScroll: true })` Chromium left the scroll to the
  sheet's `nearest` (18px under without the fix), but WebKit still scrolled the date
  input to the end. `scrollIntoView({ block: "nearest" })` moves it only as far as the
  padding asks, on both. So on WebKit `preventScroll` did not hold for this date input,
  unlike the button of R-215 and the general rule of R-106.
- **Source:** measured (#230 builder, production build at 0f907ff, Pixel 5 on Chromium
  and iPhone 13 on WebKit, every `env(safe-area-inset-bottom)` served as 34px as in
  R-218); not re-measured by the docs step.
  [HTML Standard, `focus()`](https://html.spec.whatwg.org/multipage/interaction.html#dom-focus)
- **Used by:** D-230-5

### R-224 · A child's layout effects run before its parent's, and a `ResizeObserver` answers after both (read and measured)

- **Finding:** React commits layout effects depth-first: a function component's
  `useLayoutEffect` runs after every layout effect in its subtree. Resize observations
  are gathered and delivered in the event loop's rendering step, after layout and before
  paint, so after the task whose commit ran those effects. So a sheet's layout effect
  that scrolls to a failure reads the `--sheet-actions` the bar's observer last wrote,
  not the bar as just drawn. When an offline team sheet drew its "Connect to change…"
  note with its failure, the bar grew from 80px to 128px at 32px, and the failure ended
  32px under it. A measure in `SheetActions`' own layout effect, a child of the sheet,
  is written first.
- **Source:** react-dom 19.3.1, `commitLayoutEffectOnFiber` (calls
  `recursivelyTraverseLayoutEffects` before `commitHookLayoutEffects`);
  [Resize Observer, HTML processing model](https://drafts.csswg.org/resize-observer/#html-event-loop);
  [HTML Standard, update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering);
  measured (#232 builder, production build, Pixel 5 on Chromium and iPhone 13 on WebKit;
  the bar's heights by the #232 verifier r1). `sheet.test.tsx` pins the order in jsdom.
- **Used by:** D-232-4

### R-225 · On a page, a tap on a partly hidden field scrolls nothing, and Tab reads `scroll-margin` only for some fields (measured)

- **Finding:** on the record page, with a field's top showing 24px above the docked Save,
  a tap focuses it and scrolls nothing, on Chromium and WebKit, whatever its
  `scroll-margin`: Notes stayed 66, 132 and 154px under the bar at the default text, 28
  and 32px. Tab onto a `<textarea>` in either engine, and onto a text `<input>` in
  WebKit, scrolls only to reveal the caret and ignores the margin: installed at the
  default text, Notes took focus 237 to 238px under the bar with no scroll, while in the
  browser, its caret hidden, it was centred 22 to 28px clear. Chromium's Tab onto an
  `<input>` or `<select>`, and WebKit's onto a `<select>`, honour the margin (Contact on
  a Pixel 5, -113 to 0). With a focus handler calling
  `scrollIntoView({ block: "nearest" })`, every tapped or tabbed field ended at the
  margin's edge (0px), a hidden one included, so not centred. Playwright's `click()`
  first scrolls a hidden field to the middle, and Chromium centres its margin box there:
  Notes' unequal margins (56px above, 144px below) left it 44px higher than without
  them.
- **Source:** measured (#238 planner, production build of main at 610f95b, Pixel 5 on
  Chromium and iPhone 13 on WebKit, in the browser and installed with every
  `env(safe-area-inset-bottom)` served as 34px as in R-218, at the default text, 28 and
  32px; re-measured by the verifier at c02d196; the `click()` case by the builder, whose
  screenshot matched it to the pixel). The margin box being what is centred is the
  builder's reading of the spec, not re-read by the docs step.
  [CSSOM View, `scrollIntoView()`](https://drafts.csswg.org/cssom-view/#dom-element-scrollintoview),
  [CSS Scroll Snap 1, `scroll-margin`](https://drafts.csswg.org/css-scroll-snap-1/#scroll-margin)
- **Used by:** D-238-1, D-238-3, D-238-7, D-238-8

### R-226 · Caddy's `reverse_proxy` writes `X-Forwarded-For`, `-Proto` and `-Host` itself, ignoring a client's values (read)

- **Finding:** by default `reverse_proxy` passes headers through, except that it sets or
  augments `X-Forwarded-For` and sets `X-Forwarded-Proto` and `X-Forwarded-Host`. It
  ignores incoming values for all three unless the sender is in `trusted_proxies`. So
  behind one Caddy with no trusted proxies, the client's address is the last
  `X-Forwarded-For` entry the app sees, and a client cannot choose it.
- **Source:** [Caddy, `reverse_proxy` › Headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
  (caddyserver/website `reverse_proxy.md`, read through `gh api` on 2026-11-21). Not
  measured by the docs step; the #244 builder's sign-ins through the edge worked.
- **Used by:** D-244-7

### R-227 · A toxiproxy latency toxic delays one direction only (read)

- **Finding:** a `latency` toxic adds `latency` ± `jitter` to the data on one stream:
  `downstream` (server to client) by default, or `upstream`. For a round-trip delay, put
  one on each stream. Toxics are added and removed through the HTTP API at runtime, with
  no restart of the proxy or its clients.
- **Source:** [Shopify/toxiproxy README, Toxics › latency](https://github.com/Shopify/toxiproxy#latency)
  (read through `gh api` on 2026-11-21).
- **Used by:** D-244-10

### R-228 · With `target-branch`, Dependabot's security updates take none of the entry's options, and the config is read from the default branch (read)

- **Finding:** when an entry sets `target-branch`, its version updates check and target
  that branch. Its options then no longer apply to security updates, "because security
  updates always use the default branch". That covers groups (`applies-to:
security-updates` included), ignores, labels, assignees and the commit-message prefix.
  `dependabot.yml` must sit on the default branch. Its `docker-compose` updater picks
  files by `/(docker-)?compose(-[\w]+)?(?>\.[\w-]+)?\.ya?ml/i`, which matches
  `docker-compose.stage.yml`.
- **Source:** github/docs `dependabot-options-reference.md` (commit 92ac1df), sections
  `target-branch` and the shield-marked options;
  `about-the-dependabot-yml-file.md` ("in the default branch");
  dependabot-core `docker/lib/dependabot/docker_compose/file_fetcher.rb`
  (`FILENAME_REGEX`, commit 2e6fcea). All read through `gh api` on 2026-11-21.
  Security updates were off on the repository (`automated-security-fixes`: `enabled:
false`) on that date.
- **Used by:** D-244-3, D-244-13; the conflict with D-118-7 and D-166-11 in #244's open
  questions

### R-229 · A Vercel function's default size is 1 vCPU and 2 GB

- **Finding:** Vercel's Standard function size, the default, is 1 vCPU and 2 GB of memory.
  New projects run their functions in `iad1` (Washington, D.C.) unless a region is chosen.
- **Source:** [Vercel, configuring memory and CPU](https://vercel.com/docs/functions/configuring-functions/memory)
  and [Vercel, configuring regions](https://vercel.com/docs/functions/configuring-functions/region),
  as the #244 builder and #247 read them. The docs step could not reach vercel.com, so
  neither was re-read.
- **Used by:** D-244-14

### R-230 · The stage stack with a year of records: what the check measured (measured)

- **Finding:** in one phone's requests, the latency comes from database round trips, not
  rows.
  - **No added delay:** API reads took 16 to 48 ms at p50, and pages 9 to 21 ms.
  - **2 ms round trip:** API reads took 24 to 74 ms.
  - **220 ms round trip:** every API read took at least about 700 ms. A block's units took
    2.1 s, a unit's history 1.6 s, a save 3.0 s and a sign-in 1.7 s. Member pages that
    read nothing stayed at 8 to 19 ms. Admin pages took 250 to 960 ms, as they read the
    database.

  The app sends API JSON uncompressed: before the edge had `encode`, every API route's
  size as sent equalled its decoded size, and `/api/history` was 126.6 KB a page. With
  `encode zstd gzip` it went out at 11.0 KB. One member making every round's save had 14
  of 20 refused by the 30-a-minute limit. `/api/auth/csrf` behind the edge set a second
  `__Host-authjs.csrf-token` cookie with a `callback-url` of `https://0.0.0.0:3000`.

- **Source:** measured by the #244 builder on 2026-11-21 with `npm run stage:perf`, using
  20 rounds (8 at 220 ms) on a freshly seeded stack. Other builds shared the machine, so
  single milliseconds are noise. Not re-measured by the docs step.
- **Used by:** D-244-9, D-244-23

### R-231 · iOS Safari draws a native date input content-box with a 30px min-height, whatever the page sets (measured on a simulator)

- **Finding:** in Safari on iOS, an `<input type="date">` with its native appearance keeps
  a content-box size and a 30px min-height, ignoring the page's `box-sizing`, `width`
  and `min-height`. On All records at 430px, From and To were 221 × 32 in 194px cells
  beside 194 × 51 selects, so To ran from x 219 to 441. The follow-up sheet's input was
  28px wider than its column. With `appearance: none` each takes the field's box: 194 ×
  51, and 96px tall at 32px text, where a filled date wraps to two lines. Playwright's
  WebKit and Chromium do not draw iOS's control and never showed the overflow. With and
  without the rule both gave the same 179 × 48 box, 12px padding, 1px border and 8px
  radius, and Chromium kept its calendar icon. Tailwind 4.3.5's preflight already sets
  `::-webkit-date-and-time-value { min-height: 1lh; text-align: inherit }`. That keeps an
  empty date's height on iOS and lets its value start-align.
- **Source:** measured in Safari on an iOS 26.5 simulator, iPhone 15 Pro Max, 430px (#245
  builder; before and after at 16 and 32px by the verifier r0), not on a real device.
  Chromium and desktop WebKit compared with and without the rule by the #245 reviewer.
  `node_modules/tailwindcss/preflight.css` lines 319-327 (4.3.5).
- **Used by:** D-245-1, D-245-2, D-245-4

### R-232 · A filter change through `router.replace` waits on an RSC fetch and falls back to a page load; through `history.replaceState(null, …)` it makes none (measured)

- **Finding:** on `/admin/attention`, whose page reads no `searchParams`,
  `router.replace` for a block or the toggle fetched the page's RSC payload, and
  `useSearchParams` moved only when it committed: with the fetch held 1 s, the select
  read the block just left and the toggle stayed unpressed for the whole second.
  Offline, Next logged "Failed to fetch RSC payload … Falling back to browser
  navigation", and the worker answered that navigation with the Offline page. With
  `window.history.replaceState(null, "", href)`, Next's patch (R-141) restored the
  router to the new URL in a transition: no RSC fetch, no document load and no new
  history entry; the select showed the new block by the second frame and the toggle by
  the first; offline the screen stayed; Back after a client navigation away restored
  both from the entry. Handed `history.state` (Next's `__NA`) instead of `null`, the
  call went straight through, `useSearchParams` never moved, and the next filter
  written dropped the first.
- **Source:** next 16.4.5, `dist/client/components/router-reducer/fetch-server-response.js`
  (the fallback) and `dist/client/components/app-router.js` (the patch); measured (#246
  verifier r0 at 1c1f036 and r1 at 4490b2c, production build, Pixel 5 on Chromium,
  iPhone 13 and iPhone 15 Pro Max on WebKit, whose offline mode bypasses the worker,
  D-32-18). Extends R-140 from the `?q=` strip to filter changes.
- **Used by:** D-246-10, D-246-17, D-257-1, D-257-2

### R-233 · Zod 4's `z.uuid()` takes only RFC 9562 layouts; the client's `asUuid` takes any 8-4-4-4-12 hex

- **Finding:** `z.uuid()` with no version wants a version digit 1 to 8 and a variant
  digit 8, 9, a or b (either case), or the nil or max UUID. `asUuid`
  (`src/lib/history/record-filters.ts`) tests only the 8-4-4-4-12 hex shape, which is
  Zod's looser `guid`. So `12345678-1234-1234-1234-123456789012` passes the client's
  check, and the API, whose `blockId` and `teamId` are `z.uuid()`, refuses it with 400.
- **Source:** zod 4.6.7, `node_modules/zod/v4/core/regexes.js` (`uuid`, `guid`);
  `src/generated/zod.gen.ts`. Read (#246 reviewer, docs step).
- **Used by:** D-246-3

### R-234 · `attachDatabasePool` keeps a Vercel instance awake for a pg pool's idle timeout after each release, and does nothing off Vercel (read)

- **Finding:** for a pg `Pool`, it wraps `connect` so that each client remembers the
  request it was checked out for. On every `release` it hands that request's `waitUntil`
  a promise that resolves after `idleTimeoutMillis` plus 100 ms. The wait is cut short
  1 s before the request's deadline, with a floor of 100 ms, and a later release
  replaces the earlier timer. It returns at once unless `VERCEL_URL` and `VERCEL_REGION`
  are both set. With both set and no request context, it logs "Pool release event
  triggered outside of request scope." Attaching the same pool twice does nothing (a
  `WeakSet`), `DEBUG` set to any value logs each release, and a pool type it does not
  recognise throws. Vercel's guide says idle timers do not run while an instance is
  suspended, so a connection stays open until the database drops it. The attach makes
  "idle connections close before suspension", and the guide suggests an idle timeout of
  about 5 s.
- **Source:** `node_modules/@vercel/functions/db-connections/index.js` and
  `get-context.js` (3.11.3). Vercel's guide to connection pooling with Functions, as
  quoted in #247's report; the docs step did not re-read it.
  `src/db/client.integration.test.ts` runs the 5000 + 100 ms wait on a real pool.
- **Used by:** D-250-6, D-250-7, D-250-10

### R-235 · `@vercel/functions`' root entry loads `@vercel/oidc`, and its `db-connections` subpath does not (read)

- **Finding:** the package is CommonJS. Its `index.js` requires every module, among them
  `affinity.js`, which requires `@vercel/oidc` 4.0.9. That in turn depends on
  `@vercel/cli-config` and `@vercel/cli-exec`, and through `execa` 5 on `cross-spawn`
  and its helpers. The `./db-connections` export requires only `../get-context` and
  `../deadline`.
- **Source:** `node_modules/@vercel/functions/package.json` (`exports`), `index.js`,
  `affinity.js` and `db-connections/index.js` (3.11.3), and `package-lock.json`. The
  builder found no `@vercel/oidc` in the build output; the docs step did not check that
  again.
- **Used by:** D-250-8, D-250-9

### R-236 · Neon's pooled host is PgBouncer in transaction mode, recommended for serverless, with migrations on the direct host (read)

- **Finding:** Neon says "Use the pooled connection string … for serverless functions".
  The pooled host runs PgBouncer in transaction mode, which gives each transaction
  whatever server connection is free. Neon advises running migrations against the
  direct, non-pooler host. The pooled hostname is the endpoint's name with `-pooler`
  added, and Neon's Connect dialog shows it when "Connection pooling" is on. Neon's
  connection strings carry `channel_binding`, which `database.url`'s rules refuse
  (D-75-3).
- **Source:** Neon docs, Connection pooling, as quoted in #247's report (recommendation
  2); the hostname, Connect dialog and `channel_binding` details are as the #250 builder
  read them. The docs step re-read none of it.
- **Used by:** D-250-1, D-250-3, D-250-5, D-250-11

### R-237 · Drizzle over node-postgres names a statement only through `.prepare()`, and pg-pool defaults to 10 connections and 10 s idle (read)

- **Finding:** in drizzle-orm 0.45.4, a query builder's `execute()` calls `_prepare()`
  with no name, and `NodePgPreparedQuery` passes that `name` on to pg. pg 8.23.1 sends a
  named statement, which lasts as long as the server connection, only when `name` is
  set. So only a `.prepare("name")` call makes one. pg-pool 3.14.0 defaults `max` to 10
  and `idleTimeoutMillis` to 10000.
- **Source:** `node_modules/drizzle-orm/pg-core/query-builders/select.js` (`_prepare`,
  `execute`), `node_modules/drizzle-orm/node-postgres/session.js` (`rawQueryConfig`),
  `node_modules/pg/lib/query.js` (`name`) and `node_modules/pg-pool/index.js` (the
  constructor's defaults).
- **Used by:** D-250-5, D-250-6

### R-244 · On a first OAuth sign-in Auth.js calls `jwt` with `signUp` and goes to `pages.newUser`

- **Finding:** in `@auth/core` 0.41.3's OAuth callback, the `signIn` callback is called
  before any account is made, with `user` the account already linked to this provider id
  or, failing that, the provider's own `profile()` result. It may return `false` (refused
  as `AccessDenied`), `true`, or a URL to redirect to. When `handleLoginOrRegister` then
  calls `createUser` (R-156), it passes that profile, the provider's id included, and
  reports `isNewUser`. With JWT sessions the `jwt` callback gets `trigger: "signUp"`
  instead of `"signIn"`, and with `pages.newUser` set the answer redirects there with the
  `callbackUrl`, not to it.
- **Source:** `node_modules/@auth/core/lib/actions/callback/index.js` (`handleAuthorized`,
  the OAuth branch), `node_modules/@auth/core/lib/actions/callback/handle-login.js`
- **Used by:** D-249-2, D-249-10, and #249's open question on a deactivated account

### R-245 · Chromium reads hidden text inside a link laid out as blocks with a break (measured)

- **Finding:** with the count as visually hidden text inside the Admin tab's link,
  Chromium read the link's name as "Admin , 1 …". The builder's reading: the link lays
  its children out as blocks, so a break is read between them. An `aria-label` on the
  link reads "Admin, 1 waiting for approval".
- **Source:** measured (#249 builder, Chromium); not re-measured, nor tried in WebKit,
  by the docs step.
- **Used by:** D-249-24

### R-246 · An upsert locks every conflicting row in one mode, chosen by the columns its SET names, and cannot touch a row twice (read and measured)

- **Finding:** `INSERT ... ON CONFLICT DO UPDATE` locks each conflicting row before it
  updates it. The mode is the one an UPDATE of the SET's columns would take, chosen once
  for the statement. Naming a column of a unique index a foreign key can use, such as
  `unit_number` in `households_block_unit_unique`, gives `FOR UPDATE` even when the value
  does not change. Otherwise the mode is `FOR NO KEY UPDATE` (R-124). If a statement's
  rows name one conflict target twice, the statement fails ("ON CONFLICT DO UPDATE
  command cannot affect row a second time"), so a batch upsert needs one row per unit.
  The executor takes VALUES rows in order, so sorted rows are locked in sorted order;
  this is not documented. Measured: with `unit_number` dropped from the SET, the
  parked-lock test that holds a household no longer waits. Three concurrent resends of
  25 records, beside an admin's 25 at the same units in reverse order, did not deadlock.
- **Source:** [PostgreSQL, INSERT, ON CONFLICT clause](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT);
  PostgreSQL `src/backend/executor/nodeModifyTable.c`, where `ExecOnConflictUpdate` locks
  with `ExecUpdateLockMode`, which returns `LockTupleExclusive` when the updated columns
  overlap the key columns. The docs step did not re-read that against a checkout. Also
  measured (#251 builder, verifier r0 and r1).
- **Used by:** D-251-6

### R-247 · `now()` is the transaction's start, PostgreSQL keeps microseconds, and the API's times keep milliseconds

- **Finding:** `now()` (`transaction_timestamp()`) is the time the current transaction
  started. It does not change within the transaction, so every row a statement writes
  with it gets the same time. `timestamp with time zone` keeps microseconds.
  node-postgres reads a `timestamptz` into a JavaScript `Date`, whose time value is whole
  milliseconds, and the API writes it with `toISOString()`. So rows stored a microsecond
  apart reach the phone with the same time. Measured: the 21 visits of one batch were
  stored within a single millisecond in the E2E database.
- **Source:** [PostgreSQL, current date/time](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT);
  [PostgreSQL, date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html);
  [ECMAScript, time values](https://tc39.es/ecma262/#sec-time-values-and-time-range);
  measured (#251 verifier r0).
- **Used by:** D-251-7, D-251-15

### R-248 · `Array.prototype.sort` is stable

- **Finding:** since ES2019, `Array.prototype.sort` must be stable: elements that
  compare equal keep their order. So if a list is reversed and then sorted oldest first,
  tied elements end up in the reverse of the order they arrived in.
- **Source:** [ECMAScript 2019, Array.prototype.sort](https://262.ecma-international.org/10.0/#sec-array.prototype.sort);
  [MDN, sort stability](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#sort_stability)
- **Used by:** D-251-15

### R-249 · What a sync batch costs, before and after #251 (measured)

- **Finding:** round trips per `POST /visits/sync` batch, counting every statement the
  app's connections sent, BEGIN and COMMIT included. Measured for a member on a team at
  distinct units, median of 5 runs. "Projected" is local time plus 2 ms per round trip
  (sin1 to Neon, #247).

  | Kind   | n   | Before | After | After, local ms | After, projected ms |
  | ------ | --- | ------ | ----- | --------------- | ------------------- |
  | new    | 1   | 17     | 17    | 6.6             | 41                  |
  | new    | 25  | 425    | 17    | 7.9             | 42                  |
  | new    | 50  | 850    | 17    | 9.9             | 44                  |
  | new    | 100 | 1700   | 17    | 16.1            | 50                  |
  | replay | 1   | 6      | 7     | 2.6             | 17                  |
  | replay | 25  | 150    | 7     | 2.7             | 17                  |
  | replay | 50  | 300    | 7     | 2.9             | 17                  |
  | replay | 100 | 600    | 7     | 4.1             | 18                  |
  | amend  | 1   | 16     | 16    | 4.8             | 37                  |
  | amend  | 25  | 400    | 232   | 43.1            | 507                 |
  | amend  | 50  | 800    | 457   | 76.6            | 991                 |
  | amend  | 100 | 1600   | 907   | 156.7           | 1971                |

  A follow-up session costs 19 for 1, 25 or 100 new records; before, it was 19, 475 and
  1,900. Amends cost 3 + 9n + 4. A run of 25 that falls back costs about 267 round trips.
  Locally, 25 new records took about 70 to 79 ms before and 8 to 10 ms after.
  #247 measured about 0.13 s for a 13-statement record in sin1, roughly 10 ms a
  statement. At that rate 25 amends take about 2.4 s and a fallback about 2.7 s. At
  iad1's 220 ms, a 17-statement run alone is about 4 s.

- **Source:** measured with a counting pool on `door_to_door_test_51` (#251 builder).
  #251 verifier r1 re-ran the count with `origin/dev`'s `sync.ts` swapped in for
  "before", and every count matched. The sin1 and iad1 figures are from #247's report
  (2026-11-21, recommendation 3).
- **Used by:** D-251-3, D-251-12

### R-238 · A job skipped by `if:` passes a required check; a skipped workflow leaves it pending (read)

- **Finding:** a job skipped by a conditional reports "Success" and does not block a
  merge, even when its check is required. Successful conclusions are `success`,
  `skipped` and `neutral`. A workflow skipped by path or branch filtering, or a commit
  message, leaves its checks "Pending", which blocks the merge. A job whose `needs`
  failed is skipped and "may not block merging". Required checks must pass on the
  latest commit. The Checks API's `filter=latest`, its default, "returns the most recent
  check runs". No page read says outright that a ruleset reads only the newest check run
  of a name; the builder's model (`src/ci-runs.test.ts`) assumes it, and the main session
  checks it on GitHub after the push.
- **Source:** github/docs `troubleshooting-required-status-checks.md` (commit 60f9f34),
  "Handling skipped but required checks"; `control-jobs-with-conditions.md` (93069a0);
  github/rest-api-description, the `filter` parameter of the check-run list endpoints
  (bbd57e6). All read through `gh api` on 2026-11-21.
- **Used by:** D-248-4, D-248-8, D-248-9

### R-239 · A re-run keeps its run's commit and ref, and a partial re-run keeps the other jobs' outputs (read)

- **Finding:** a re-run uses the same `GITHUB_SHA` and `GITHUB_REF` as the event that
  started the run, with the privileges of the actor who started it. `github.run_attempt`
  is a string, `1` on the first attempt, and increments with each re-run. Re-running
  failed jobs or one job also re-runs the jobs that need them, and jobs left out keep
  their outputs from the previous attempt. That the event payload (`draft`, labels, base)
  is replayed too is not stated on the page; review r1 of #248 found it, and the lint
  job's API read (D-248-10) no longer depends on it.
- **Source:** github/docs `re-run-workflows-and-jobs.md` (commit 6abed3d);
  `contexts.md` (`github.run_attempt`). Read through `gh api` on 2026-11-21.
- **Used by:** D-248-10, D-248-11

### R-240 · `pull_request` events, their payloads and a job's default timeout (read)

- **Finding:** a `pull_request` workflow runs only on `opened`, `synchronize` and
  `reopened` unless `types` names others, such as `ready_for_review`, `labeled` and
  `edited`. Its `GITHUB_SHA` is the test merge commit on `refs/pull/<n>/merge`. An
  `edited` payload carries `changes.base.ref.from` when the base changed. No
  `pull_request` workflow runs while the pull request has a merge conflict. Expressions
  compare strings ignoring case. A job's `timeout-minutes` defaults to 360.
- **Source:** github/docs `events-that-trigger-workflows.md` (commit 3d26e90),
  `expressions.md`, `workflow-syntax.md` (28d2706); github/rest-api-description,
  `webhook-pull-request-edited` (bbd57e6). Read through `gh api` on 2026-11-21. That the
  merge commit's first parent is the base is GitHub's merge-ref layout, which
  `scripts/ci-changes.sh` relies on; no page read states it.
- **Used by:** D-248-1, D-248-5, D-248-6, D-248-8, D-248-12

### R-241 · A pull request run's caches are its own (read)

- **Finding:** a cache made by a `pull_request` run is scoped to `refs/pull/<n>/merge`
  and only re-runs of that pull request can restore it, not its base or another pull
  request. A pull request run can restore caches from its own ref, its base branch and
  the default branch, here `main`. Only a run on a branch, such as a push, fills that
  branch's scope; `warm-caches.yml` fills `dev`'s and `main`'s (D-248-21, D-248-26), and
  `stage`'s stays empty.
- **Source:** github/docs `dependency-caching.md` (commit 6d84733), "Restrictions for
  accessing a cache". Read through `gh api` on 2026-11-21.
- **Used by:** D-248-13, D-248-21, D-248-26

### R-242 · Dependabot's `rebase-strategy`, monthly schedule and labels (read)

- **Finding:** by default Dependabot rebases an open pull request when its schedule
  runs, when it is reopened, when `target-branch` changes, and when a push to the target
  branch puts it in conflict. `rebase-strategy: disabled` stops that, but pull requests
  opened before keep being rebased until 30 days after they were opened. `monthly` runs on
  the first day of the month. A label named in `labels` that the repository does not
  define is ignored; `e2e` was defined on 2026-11-21. With `target-branch` set, none of
  these options reach security updates (R-228).
- **Source:** github/docs `dependabot-options-reference.md` (commit 92ac1df), sections
  `rebase-strategy`, `schedule` and `labels`; `gh label list`. Read on 2026-11-21.
- **Used by:** D-248-14, D-248-15

### R-243 · Playwright advises against caching its browsers (read)

- **Finding:** "Caching browser binaries is not recommended", because restoring the
  cache takes about as long as downloading them, and on Linux the system packages must
  be installed anyway and cannot be cached. If cached, key the cache on the Playwright
  version.
- **Source:** microsoft/playwright `docs/src/ci.md` (commit 1c9b809), "Caching browsers"
  ([Playwright, CI](https://playwright.dev/docs/ci#caching-browsers)). Read through
  `gh api` on 2026-11-21.
- **Used by:** D-248-13

### R-250 · A skipped job's name expression shows as written (measured)

- **Finding:** when a job whose `name:` is an expression is skipped, its check run is
  named by the expression's text, the inside of `${{ }}`, not its value. A fixed name
  shows as is. So a skipped job with an expression name never reports, or passes, a
  required check. The same runs show CI's placeholder skip at the run's start and its
  E2E job's skip after lint, about two minutes later. No docs page read states the
  naming either way, and an expression name on a job that runs was not seen here.
- **Source:** #260's runs on `24406e6`: CI 44908665916 (its `e2e` job) and E2E catch-up
  44908763351 (its one job, on the retarget to `dev`), through `gh run view --json jobs`
  and `gh api …/commits/<sha>/check-runs` on 2026-11-21.
- **Used by:** D-248-9, D-248-18, D-248-19, D-248-20

### R-251 · A cache is found only under its key and path, and saved only by a job that succeeds with a new key (read)

- **Finding:** a cache's version hashes its `path` and the compression tool, and a
  restore matches key and version, so the same key under another path is a miss. A miss
  on `key` tries prefix and `restore-keys` matches, newest first; `cache-hit` is `true`
  only for an exact `key`. The post step saves the cache only when the job succeeds
  (`post-if: success()`) and the key was not already there; `lookup-only` skips the
  download and leaves saving as it is. `setup-node`'s npm key is
  `node-cache-<OS>-<arch>-npm-<lockfile hash>`, also saved on success when the key is
  new.
- **Source:** actions/cache `README.md` and `action.yml` at 55cc834 (v6.1.0), "Inputs",
  "Outputs", "Example cache workflow" and "Cache Version"; actions/setup-node
  `src/cache-restore.ts`, `src/cache-save.ts` and `action.yml` at 949feb2 (v7.1.0);
  github/docs `dependency-caching.md` (commit 6d84733), "Cache key matching". Read
  through `gh api` on 2026-11-21 (#248 docs step).
- **Used by:** D-248-24, D-248-25

### R-252 · A commit GitHub makes names `GitHub <noreply@github.com>` as its committer (measured)

- **Finding:** on this repository, the commits GitHub made have committer
  `GitHub <noreply@github.com>`: squash merges, merge commits from the merge button and
  Dependabot's, 122 in all. The author stays the person or bot, and the four checked
  (`e49313a`, `3e92d4c`, `7f5ac21`, `0a562a0`) carry a valid signature. GitHub's docs say
  commits made in the web interface are signed with the web-flow key, but name no
  committer. A web edit and **Update branch** were not seen here.
- **Source:** `gh api repos/{owner}/{repo}/commits/<sha> --jq .commit.committer` and
  `git log --all --committer=noreply@github.com`, on 2026-11-22; github/docs
  `about-commit-signature-verification.md` (commit 3c5bf3c). #248 docs step.
- **Used by:** D-248-28

### R-253 · `router.replace` on a static route stays on the device for 5 minutes; after that, or on a dynamic route, it asks the server, and offline leaves the screen (measured)

- **Finding:** Next keeps its client copy of a static route, which the bottom nav
  prefetches on load, for `staleTimes.static`: 5 minutes by default. The app does not
  set it. Within that time a `router.replace` to `/history?view=team` or
  `/follow-ups?view=mine` sent no RSC request, so offline the screen stayed with its
  alert. After it, and at once if the prefetch never landed, the replace fetched the RSC
  payload. Offline that failed, and Next fell back to a page load (R-232). The Pixel
  showed the worker's Offline page, and Playwright's WebKit, which has no worker
  offline (D-32-18), ignored the tap. On the Pixel, the dynamic routes
  `/admin/follow-ups` and `/history/[sessionId]` (`dynamic` defaults to 0 s) showed
  Offline on the first tap.
  Through `useAddressFilters` all four stayed on screen with no RSC request: warm, cold,
  with every prefetch refused, and 6 minutes after load.
- **Source:** `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`
  (next 16.4.5). Measured by #257's builder (warm, Chromium with the worker) and by its
  verifier r1 and r2 using Playwright's clock (4 and 6 minutes after load). Production
  build, Pixel 5 on Chromium, iPhone 13 and iPhone 15 Pro Max on WebKit.
- **Used by:** D-257-2

### R-254 · React `cache()` lasts one server render, and a Route Handler or Server Action is not one (read and measured)

- **Finding:** Next's guide says React's `cache` "deduplicates within a React render
  pass. Server Actions and Route Handlers are not part of a render pass, so the wrapper
  does nothing and every call runs the function." #252's reviewer found that Next's
  app-route runtime has no React cache dispatcher. Outside a request, Flight's
  `getCacheForType` returns a new `Map` each time. On the standalone build, with a pg
  tracer, each admin page made 1 sign-in query (2 in #247), and every API request made
  exactly 1, back-to-back repeats included.
- **Source:** `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1181`
  (Next 16); #252 reviewer r1; #252 verifier r0 and r2.
- **Used by:** D-252-4

### R-255 · An empty `generateStaticParams` builds each path on its first request and keeps it (read and measured)

- **Finding:** "To statically render all paths the first time they're visited, return
  an empty array." With Cache Components on, an empty array is a build error. The app
  does not use Cache Components. On the standalone build, `/households/[id]` is `●`
  (`ƒ` before). Its first request is a MISS and the next a HIT, with 0 queries and the
  proxy's `Cache-Control: no-store` kept. Any id is built and kept, invalid ones
  included. After one device pass the server held 100 unit pages, most from Link
  prefetches as rows scrolled into view. Not checked on Vercel.
- **Source:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`
  ("All paths at runtime", "With Cache Components"); #252 build output; #252 verifier r0
  and r2.
- **Used by:** D-252-12

### R-256 · An index serves `ORDER BY … DESC` only in its own null order; Drizzle's `.desc()` is NULLS LAST; a plain `CREATE INDEX` blocks writes (read and measured)

- **Finding:**
  - In PostgreSQL a plain `DESC` sorts nulls first. A B-tree serves an `ORDER BY` only
    when it is scanned forward or backward in that exact order, nulls included.
  - drizzle-orm's `.desc()` on an index column sets nulls to `"last"`, so `.nullsFirst()`
    is needed.
  - On 2,109 visits, All records' first page with the NULLS FIRST index is an Index Scan
    on `visits_created_id_idx`, 0.2 ms. With a NULLS LAST index in its place, it is a Seq
    Scan and a top-N sort. #247 measured 15,390 visits: page one went from 18.1 to
    0.45 ms, and offset 10,000 from 30 to 15.8 ms, with no sort spilling to disk.
  - `CREATE INDEX` without `CONCURRENTLY` locks the table against writes, not reads, until
    the build ends. `CONCURRENTLY` cannot run inside a transaction block, and drizzle-orm's
    `migrate` applies every pending migration inside one transaction.
- **Source:** PostgreSQL docs, "Indexes and ORDER BY" and `CREATE INDEX` ("Building
  Indexes Concurrently"); `node_modules/drizzle-orm/pg-core/columns/common.js:76-97` and
  `pg-core/dialect.js:60-71` (`migrate`); #252 verifier r0 and r1; #247's report,
  recommendation 8.
- **Used by:** D-252-8

### R-257 · Vercel's 4.5 MB response limit against a 250-record `/history` page (measured; the limit as cited)

- **Finding:**
  - A Vercel Function's response body may be at most 4.5 MB.
  - `GET /api/history?limit=250`, with every field at its maximum length in Chinese text
    and no team, measured 4,009,326 bytes (3.82 MiB), about 11% under the limit. The
    builder's 3.3 MB estimate was low.
  - Teams are uncapped, and each teammate adds a name and an image URL to every record.
  - The API accepts control characters. A description of 3,999 U+0001 is 26.8 KB as
    JSON, so 250 such records would be about 6.7 MB. At 100 a page they were about
    2.7 MB.
- **Source:** Vercel docs, Functions limitations, as #252's reviewer and verifier cited
  them. The docs step did not re-read them, nor check whether the limit applies before or
  after compression. The sizes were measured by #252 verifier r1 on the local build.
- **Used by:** D-252-6

### R-258 · node-postgres: a pool lends a connection to each query in flight and queues the rest; a client runs its queries in turn (read and measured)

- **Finding:**
  - pg-pool 3.14.0 gives each query in flight a connection, an idle one first, and opens
    new ones up to `max`. Past that it queues the query. With no
    `connectionTimeoutMillis`, which the app does not set, a queued query waits rather
    than fails.
  - A `Client` runs one query at a time. pg 8.23.1 warns that calling `client.query()`
    while one is executing "is deprecated and will be removed in pg@9.0". That is what
    `Promise.all` on a transaction's client would do.
  - Measured on the standalone build with a cold pool: `/api/sessions/active` took 4
    round trips and opened 2 connections, and a unit's history took 3 with 1 new. Warm,
    they took 3 and 2. Locally a new connection cost 20 to 40 ms. #247 puts one at about
    12 ms from sin1, against about 2 ms a query.
- **Source:** `node_modules/pg-pool/index.js:190-262` (`connect`);
  `node_modules/pg/lib/client.js:34-36, 779-780`; #252 verifier r0 and r1; #247's
  report.
- **Used by:** D-252-1, D-250-6 (its reasoning)
