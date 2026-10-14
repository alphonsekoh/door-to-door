# #32 · PWA manifest, icons, install prompt and service worker

- **Status:** In review (PR #73; D-32-19 to D-32-21 in PR #93)
- **Phase:** 6 - PWA & Offline

## Task

Make the app installable and the shell load with no network.

## Decisions

- ~~**D-32-1 · Serwist (`@serwist/next`), not `next-pwa`.**~~ Superseded by D-32-2.
  _Research:_ R-1.
- **D-32-2 · Serwist via `@serwist/turbopack`, served by a route handler at
  `/serwist/sw.js` (no-cache headers). Supersedes D-32-1.** Same family, different
  package. _Why:_ Next 16 builds with Turbopack by default and `@serwist/next` is a
  webpack plugin. _Research:_ R-1, R-17.
- **D-32-3 · API GET allow-list is `GET /api/blocks` only, and only plain `200`
  responses, stale-while-revalidate.** Never `/sessions/active` nor any session,
  follow-up, history, household or visit read. _Why:_ a stale `/sessions/active` would
  hide an ended outing (D-10-7) and cached reads must not outlive D-21-4's server
  truth. Everything else under `/api` is network-only. _Research:_ R-18.
- **D-32-4 · Shell precache is static assets, icons and `/offline`; never
  authenticated HTML.** Navigations are network-only with an `/offline` fallback.
  _Why:_ a cached page could show one member's data to the next user of the device.
- **D-32-5 · The worker never touches IndexedDB and avoids `ExpirationPlugin`.** The
  block-list cache has its own bounded plugin (24h, 20 entries, evict by a stored-at
  header); a test asserts no IndexedDB use. _Why:_ the offline queue (#33) owns that
  store. _Research:_ R-19.
- **D-32-6 · Updates are prompted.** `skipWaiting` and `clientsClaim` are off, the page
  never reloads on its own, and the prompt defers while `hasUnsyncedItems()` is true
  (a stub returning false until #33). _Why:_ acceptance criterion "a new deploy does
  not discard unsynced data". Consequence: a page is controlled from its second load.
- **D-32-7 · The block cache is cleared on sign-in** via `clearServiceWorkerCaches`.
  _Why:_ a different member signing in must not see the previous list. Sign-out wiring
  is done in #74: see D-74-9 and D-74-10. ~~**Known limit:** until then sign-out
  leaves the cached list.~~
- **D-32-8 · Manifest, `/serwist/*` and `/offline` are public to the proxy.** D-16-2
  intact: no handler guard changed. _Why:_ the browser fetches them unauthenticated.
- **D-32-9 · Install banner state is derived, not stored.** A UA classifier by
  browser + OS picks a path: Chromium uses the `beforeinstallprompt` event; Android
  Firefox shows manual steps; iOS shows manual steps per browser (16.4 threshold for
  non-Safari); in-app webviews say "open in browser"; unknown shows nothing. _Why:_
  the custom prompt is not cross-browser. _Research:_ R-16, R-20, R-21.
- **D-32-10 · An "installed" flag is cleared when a real `beforeinstallprompt`
  fires.** _Why:_ firing proves the app is no longer installed (uninstalled since).
- **D-32-11 · Dismissal suppresses the banner for 30 days.** _Why:_ dismissible, not
  nagging (issue).
- **D-32-12 · Banner is signed-in only; hidden on public routes and `/blocks/*`.**
  _Why:_ it must not cover the recording form or the sign-in screen.
- **D-32-13 · Banners reserve layout space via `--banner-top` / `--banner-bottom`
  and sit at `z-30`, below the nav `z-40`.** Relies on D-30-7. _Why:_ fixed banners
  covered content before.
- **D-32-14 · Registration is classic; `cacheOnNavigation` and `reloadOnOnline` are
  off; the worker is disabled outside production builds.** _Why:_ the first two cache
  authenticated pages / reload under the user (D-32-4, D-32-6); dev worker caches
  confuse HMR.
- **D-32-15 · Offline "Try again" goes to `/`.** _Why:_ simplest safe target;
  returning to the prior screen is not built. **Known limit.**
- **D-32-16 · Lighthouse "PWA audit passes" is reinterpreted as installability checks
  plus responsive/mobile-friendly checks**, verified with Playwright at phone width.
  _Why:_ Lighthouse 12 dropped the PWA category (owner-approved). _Research:_ R-23.
- **D-32-17 · A cold offline launch shows the static `/offline` page.** Offline
  recording is #33. _Why:_ owner-accepted scope cut.
- **D-32-18 · WebKit (iPhone 13) joins the Playwright projects and CI. Supersedes
  D-37-2.** Safari is covered by E2E except the offline-fallback navigation, which
  Playwright WebKit cannot exercise (owner-approved). _Research:_ R-22.

### Decisions from PR #93 (CI flake fix, no issue)

- **D-32-19 · The cookieless PWA paths (`/serwist/*`, `/manifest.webmanifest`,
  `/offline`) skip `auth()` in the proxy; `/sign-in` and `/api/auth/*` still run it.**
  Extends D-32-8. _Why:_ `auth()` mints a CSRF cookie on any request without one, and
  WebKit stores it from the worker's cookieless update check, swapping the member's token
  mid sign-out; `/sign-in` must keep handing out its CSRF cookie with the page so the
  form's first auth requests do not each mint one. _Research:_ R-40.
- **D-32-20 · `useReservedSpace` publishes `--banner-*` from a layout effect.** Extends
  D-32-13. _Why:_ a passive effect runs after paint, so each banner's first frame
  covered content. Same cause as the update-prompt half of #88 (that half is fixed; the
  block-attach-sheet half is not).
- **D-32-21 · A failed cache clear on sign-in never blocks it.** Extends D-32-7, mirrors
  D-74-9. _Why:_ the session is already set, and a rejection left the button disabled
  with no message.

## Relies on

D-11-1 (custom transport), D-21-4 (queued work is never discarded), D-10-7, D-16-2,
D-30-7, D-37-6 (the PWA spec stays thin).

## Open questions

- Real-device checks outstanding: Samsung Internet install event, third-party iOS
  browsers, iPad desktop-mode UAs (R-16, R-20, R-21).
