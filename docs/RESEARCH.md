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
- **Used by:** D-74-43, D-33-5

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
- **Source:** observed during #74 PR 4 (`e2e/pwa.spec.ts`, "admin filter selects are at
  least 44px tall")
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
- **Used by:** D-32-19

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
- **Source:** [CSS Containment 3, the `@container` rule](https://drafts.csswg.org/css-contain-3/#container-rule);
  seen in PR #112, fix round 8
- **Used by:** D-111-60

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
- **Used by:** D-117-51

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
- **Used by:** D-122-10

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
- **Used by:** D-132-4, D-132-5, D-132-8, D-158-2, D-158-5, D-158-7

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
- **Used by:** D-132-2, D-132-5, D-158-2, D-158-5, D-158-7

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
- **Used by:** D-129-10, D-164-5

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
- **Source:** #163 verifier, round 0 (Playwright network logs)
- **Used by:** D-163-6

### R-141 · Next syncs `useSearchParams` with `history.replaceState` through a patch its router installs in an effect

- **Finding:** The app router replaces `history.pushState` and `replaceState` in a
  `useEffect`. A call whose state has `__NA` or `_N` goes straight to the native method
  and tells the router nothing; any other gets Next's `__NA` and
  `__PRIVATE_NEXTJS_INTERNALS_TREE` copied in, and the router is restored to the URL,
  which is what moves `useSearchParams`. On `popstate`, an entry with no state is ignored
  and one without `__NA` reloads the page. So a call before the patch must carry
  `history.state` itself. The docs promise the sync, not when the patch is in place.
- **Source:** `node_modules/next/dist/client/components/app-router.js` (16.4.3);
  `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`,
  "Native History API"
- **Used by:** D-163-6

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
- **Used by:** D-155-1, D-155-2, D-155-3, D-155-6, D-155-7, D-171-1, D-171-2

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
- **Used by:** D-14-3, D-14-4, D-14-7

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
- **Used by:** D-158-2, D-158-6

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
- **Used by:** D-164-1, D-164-3, D-164-7, D-164-8

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

### R-179 · A `visibility: hidden` `::after` holds layout, but no test or screen reader reads it

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

### R-180 · CI's Linux WebKit draws text in DejaVu Sans, which measures only from the same origin

- **Finding:** the app's `system-ui` stack falls back to DejaVu Sans on CI's Ubuntu
  runner. That face is wider than macOS's. At 32px with `px-3`, it set "Follow-up
  marked" a few px past one line. With `px-2` there is about 8px to spare. To measure in
  it locally, serve the font from the app's own origin. The CSP has `default-src 'self'`
  and no `font-src`, so a `data:` font is reported as a violation (Report-Only, D-122),
  and the E2E fails on any violation.
- **Source:** CI run 43375997037's screenshots; `src/server/http/security-headers.ts`;
  measured (#136 builder and verifier r0, with DejaVu Sans served from the app's origin)
- **Used by:** D-136-9

### R-181 · A `test.fail` test that fails as declared is `expected`, yet keeps its error

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

### R-182 · A sticky `bottom: 0` bar sits above its scroller's padding; `scroll-padding` counts from the scrollport

- **Finding:** in both engines, a `position: sticky; bottom: 0` child sticks inside the
  scroll container's padding. A sheet's bar therefore rests above the body's
  `env(safe-area-inset-bottom)` padding. `scroll-padding-bottom` is an inset from the
  scrollport's edge, so it must add that padding to clear the bar. Leaving it out, a
  field brought into view ends `inset - 16px` under the bar: 18px with a 34px home
  indicator.
- **Source:** [CSS Scroll Snap 1, `scroll-padding`](https://drafts.csswg.org/css-scroll-snap-1/#scroll-padding);
  #136 reviewer r2, not re-measured by the docs step
- **Used by:** D-136-3 (known limit)
