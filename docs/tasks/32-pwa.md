# #32 · PWA manifest, icons, install prompt and service worker

- **Status:** Open
- **Phase:** 6 - PWA & Offline

## Task

Make the app installable and the shell load with no network.

## Decisions

- **D-32-1 · Serwist (`@serwist/next`), not `next-pwa`.** _Research:_ R-1.

## Relies on

D-11-1 (custom transport), D-21-4 (queued work is never discarded), D-37-2 (Safari
uncovered by E2E).

## Open questions

- Runtime caching of API GETs (stale-while-revalidate is in the issue) must not serve a
  stale `GET /sessions/active` that hides an ended outing. Decide which endpoints are
  cached.
- How to test on iOS given D-37-2.
