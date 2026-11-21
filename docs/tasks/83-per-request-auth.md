# #83 · Deactivation and role changes take effect on the next request

- **Status:** Done (PR #84)
- **Phase:** 2 - Auth
- **Depends on:** #13, #16, #31

## Task

Bug fix. A deactivated user kept working, and a demoted admin kept admin rights, until the
JWT expired: `requireUser` / `requireRole` trusted claims written at sign-in, and nothing
re-read the database. D-10-4 and D-16-3 promised otherwise. Tests passed because they
injected a session object.

## Decisions

- **D-83-1 · Role and deactivation are read from the database on every API request and
  every admin page.** One primary-key lookup in `resolveSession` / `currentSession` /
  `currentUser` (`src/server/auth/session.ts`). _Why:_ the token cannot know about changes
  made after sign-in. _Research:_ R-32. _Extended by D-249-5 (#249):_ so is approval.
- **D-83-2 · The guards stay pure.** `requireUser`, `requireRole`, `requireAdmin`,
  `isAdmin` and `resolveMemberScope` receive a session built from the DB row and do no I/O.
  _Why:_ unit-testable, and the lookup lives in one place.
- **D-83-3 · The token carries identity only.** Its `role` and `deactivated` claims are
  hints for nav and affordance; nothing server-side reads them for authorization. _Why:_
  they are frozen at sign-in.
- **D-83-4 · Outcomes.** Missing user row: `401`. Deactivated: `403 account_deactivated`.
  Demoted admin: `403` on admin routes, `404` on admin pages. ~~Reactivated: works again
  without signing in.~~ _Why:_ matches D-10-4 and the existing page convention.
  _Partly superseded by D-125-10 (owner, 2026-11-05):_ deactivation ends every sign-in,
  so a reactivated member signs in again. _Refined by D-125-17:_ a request with no live
  sign-in, a deleted account's included, is sent from admin pages to sign in, not to a
  `404`. _Extended by D-249-4 (#249):_ waiting for approval is `403 account_pending`,
  rejected `403 account_blocked`, except on `/users/me`; admin pages send both to
  `/waiting`.
- **D-83-5 · A lookup failure rejects and surfaces as `500`; it never fails open.** A
  session with no usable user id resolves to `null`, and `isAdmin` also requires an id.
  _Why:_ an outage must not grant access. _Scope stated by D-125-13:_ this governs
  authorization. Auth.js's session endpoint, which authorizes nothing, keeps the cookie
  when its sign-in check fails.
- **D-83-6 · No cache, not even a short TTL.** _Why:_ a TTL is a window where a
  deactivated account still works, and a per-process cache cannot bound it across
  instances.
- **D-83-7 · Cost accepted.** One indexed lookup per request; two on `GET /users/me`
  (it also loads `lastRecordedAt`). _Why:_ correctness over a saved query on a small table.
  _Extended by D-125-3 and D-125-6:_ the same query also checks the token's sign-in, and
  "last used" costs at most one write per sign-in per 15 minutes.
- **D-83-8 · `currentSession` awaits `auth()` before `getDatabase()`, and a signed-out
  request skips `getDatabase()`.** _Why:_ the reverse order made `next build` read the
  database for prerendered admin pages; `auth()` opts the page into dynamic rendering.
  _Research:_ R-33.
- **D-83-9 · A deleted account is `401` on `/users/me` and `PATCH /users/me`** (was `404`).
  `openapi.yaml` descriptions updated. _Why:_ the per-request check answers first, so a
  deleted user's cookie reads as signed out.
- **D-83-10 · The lookup runs before the sync rate limiter.** A throttled client still
  costs one query. _Why:_ identity is needed to key the limiter; accepted.
- **D-83-11 · A batch that began before a deactivation may complete.** Check-then-act
  window of milliseconds. _Why:_ closing it needs a lock per write; not worth it.
  _Refined by D-132-7:_ `POST /visits` now locks its author (D-132-4), so a single
  record is refused once a deactivation lands; a sync batch keeps this window. _Refined
  by D-158-4:_ so is a member's own `createTeam`, which locks their row with the others
  it places.
- **D-83-12 · A repo-wide test (`src/server/auth/auth-imports.test.ts`) enforces the
  path.** Only `session.ts` and the Auth.js route may import the root auth module, and
  every API route must import `@/server/auth/session`. _Why:_ the original bug was a
  handler quietly bypassing the check; a test catches the next one.
- **D-83-13 · `admin/layout.tsx` calls `requireAdminPage` as a structural guard**, and
  each admin page keeps its own call. _Why:_ layouts do not re-render on client-side
  navigation, so the layout alone is not enough.
- **D-83-14 · The Account page keeps Sign out visible when `/users/me` returns `401` or
  `403 account_deactivated`.** _Why:_ otherwise a stale session cannot be cleared.
- **D-83-15 · Known limits, accepted.** (a) A demoted admin sees a stale "Admin" nav item
  until the token refreshes; nothing privileged is reachable, and D-74-6 means the token
  update accepts only a name; closed by D-85-8. (b) ~~The old cookie still works after
  sign-out (stateless JWT).~~ Superseded by D-125-9 (owner, 2026-11-05): signing out ends
  that sign-in on the server. (c) Auth.js `/api/auth/session` echoes stale claims; partly
  closed by D-125-14, since an ended sign-in now names nobody. (d) Validation runs before
  auth on some routes, so malformed input gets `400` before `403`; cosmetic.

## Supersedes and amends

- **Supersedes D-13-2** for authorization (struck in `13-authjs.md`). The token still
  carries role and deactivation, as hints (D-83-3).
- **Amends D-16-3:** the per-request check now reads the database. Before this it only
  read the token flag, so it was not a per-request check of the account at all.
- **Amends D-16-2:** the session passed to the guards must come from `currentSession`
  (D-83-12 enforces it).
- **D-10-4:** reasoning unchanged; the `403` now comes from the DB row.

## Relies on

D-13-3 (no role defaults to `member`), D-16-1 (proxy stays an optimistic redirect),
D-16-2, D-31-5 (admins cannot demote or deactivate themselves), D-74-6, D-10-4.

## Open questions

None.
