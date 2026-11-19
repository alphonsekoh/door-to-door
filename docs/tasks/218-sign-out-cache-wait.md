# #218 · Sign-out waits while Chrome clears its whole HTTP cache

- **Status:** Done (PR #219). Found by the owner on the production image run locally,
  2026-11-18.
- **Phase:** 7 - Hardening
- **Depends on:** #122, #125

## Task

Signing out stayed on "Signing out…" in a real Chrome profile, though the sign-in had
already ended on the server: a refresh showed the member signed out. The sign-out `POST`
answered with `Clear-Site-Data: "cache"` (D-122-10), and Chrome holds such an answer back
until it has cleared its HTTP cache. The app waits for the answer before it leaves for
`/sign-in`. Server only: no contract or schema change.

## Decisions

- **D-218-1 · A sign-out sends no `Clear-Site-Data`. Supersedes D-122-10 in part:**
  every `/api/auth/*` answer stays `no-store`, and nothing else in D-122-10 changes.
  _Why:_ Chrome's wait grows with the whole cache, not this app's share of it. A
  Chromium profile holding 400 MB of another site's files held the answer for 4.1s,
  against 44ms with an empty cache (R-210), and real profiles hold several GB. Nothing
  signed-in is in the HTTP cache to clear: every signed-in page, its RSC payload and
  every API answer is `no-store` (D-74-11, D-122-9, D-150-2). Sign-out still clears the worker's
  caches itself (D-74-9), replaces the history entry (D-129-3), and `RestoreGuard` reloads a page
  restored from the bfcache (D-129-1). Without the header, the same profile reached
  `/sign-in` 106ms after the tap (R-210). _Rejected:_ keeping the header and not waiting for the
  answer, since the app must read it to tell a refused sign-out (D-125-20, #162) from one
  that held.
- **D-218-2 · Tests require that no answer carries `Clear-Site-Data`, the sign-out
  `POST` and a refused one included.** In `route-headers.test.ts` and the Auth.js route's
  test. Both fail with the header put back. The E2E's refused sign-out (D-164-5) no
  longer sends it either.

### How existing decisions are handled

| Decision | Effect                                                        | By      |
| -------- | ------------------------------------------------------------- | ------- |
| D-122-10 | Superseded in part: no `Clear-Site-Data`; `no-store` stays    | D-218-1 |
| D-164-5  | Refined: the mocked refusal no longer sends `Clear-Site-Data` | D-218-2 |
| D-74-9   | Kept: sign-out clears the worker's caches itself              | D-218-1 |

## Known limits

- **The HTTP cache keeps the app's static files after a sign-out.** They hold nothing
  personal: `/_next/static` files are the same for everyone.
- **Not measured on Safari.** WebKit's handling of `"cache"` was never measured (R-116),
  so whether it waited too is unknown. It no longer matters, since nothing is sent.

## Relies on

D-74-9, D-74-11, D-122-9, D-122-10, D-125-20, D-129-1, D-129-3, D-150-2, D-164-5.

## Open questions

None.
