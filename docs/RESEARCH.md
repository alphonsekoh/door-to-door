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
  does fire one. Tests that depend on `online` must dispatch it themselves.
- **Source:** observed in PR #100 (`e2e/pwa.spec.ts`, Chromium); unverified on Linux CI
  WebKit, which skips the test (D-32-18)
- **Used by:** D-77-16

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
- **Source:** `node_modules/next/dist/build/index.js` (Next 16.3.3);
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
  (Next 16.3.3)
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
- **Source:** [HTML, the button element](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)
- **Used by:** D-111-40

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
