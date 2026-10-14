# #85 · One message when the account is deactivated or the session is invalid

- **Status:** In review (PR #98)
- **Phase:** 4 - Member UI
- **Depends on:** #83, #74

## Task

Since #83 the server refuses a deactivated or deleted account on every request, and each
screen showed its own error with a "Try again" that could only fail again. Replace that
with one full-screen message and a single way out, and let a demoted admin's nav catch up
without signing in again. No contract, schema or server change.

## Decisions

- **D-85-1 · One shared store (`src/lib/account-state.ts`) fed by `apiFetch`.** `apiFetch`
  reports the failure and still throws `ApiRequestError`. _Why:_ every caller's promise
  settles exactly as before, and the shell decides what to show in one place.
- **D-85-2 · Any `401` means signed out; only `403 account_deactivated` means
  deactivated.** A plain `403` or `404` raises nothing. _Why:_ a plain `403` refuses one
  action (a team change, an admin route after a demotion, D-83-4) and the screen that asked
  already explains it.
- **D-85-3 · The first failure wins and sticks until the next full page load.** _Why:_
  every way out is a full navigation (D-74-10), and flipping between two messages would
  only confuse.
- **D-85-4 · An opaque, undismissable `alertdialog` at `z-70`, with no Try again.** Above
  nav, banners, sheets and confirm dialogs; `overlay-layers.test.ts` asserts it is above
  every other layer. Extends D-30-7. _Why:_ nothing underneath can succeed, so nothing may
  show through or take a tap.
- **D-85-5 · The app underneath is made `inert`, not unmounted.** `AccountGate` wraps
  main, banners and nav; while the screen is up it also marks every other top-level body
  child inert, which covers sheets portalled to `<body>`. _Why:_ a half-typed form is not
  thrown away by a message the member did not cause, and no sheet had to be restructured
  (#90 is changing them).
- **D-85-6 · Deactivated: "Sign out" to `/sign-in`. Signed out: "Sign in again", which
  still signs out first, to `/sign-in?reason=signed-out`,** where the form shows a
  `role="status"` notice. `signOutAndForget` takes an optional destination; the D-74-64
  refusal check is unchanged and a refusal keeps the screen up with "Could not sign out.
  Try again." Extends D-74-10. _Why:_ a deleted account's cookie must be cleared, or the
  proxy would let it back into the shell.
- **D-85-7 · The gate reads `GET /users/me` once per document load** for a signed-in user
  on a non-public path; a failure is swallowed (offline stays silent). _Why:_
  server-rendered and not-found pages make no API call of their own, so without it a
  deactivated member could sit on one unwarned; the same read refreshes the role (D-85-8).
- **D-85-8 · `useRole` prefers the role from the latest `/users/me` when its id matches
  the token's.** Reads go through `loadCurrentUser()` (`src/lib/users.ts`; used by the
  gate, Account and Outing team), and Account records the role a `PATCH` returns. The
  token, its `update` trigger (D-74-6) and the viewer id (D-74-51) are untouched. _Why:_
  the token's role is a hint (D-83-3); this closes D-83-15(a) without widening the token.
  Still affordance only (D-16-2).
- **D-85-9 · Unsynced records: the screen tells, it does not ask.** When
  `hasUnsyncedItems()` is true it says "Records not yet sent are kept on this phone."
  instead of D-74-9's warn-before-sign-out. _Why:_ signing out is the only way forward, so
  a warning with a Cancel would only trap the member.
- **D-85-10 · Scope cut: holding queued records on this error is #33's.** The hook is in
  place: the queue's flush must go through `apiFetch` or call
  `accountStore.reportAuthFailure` itself (for example from the worker). _Why:_ the queue
  does not exist yet.

## Relies on

D-83-3, D-83-4, D-83-14, D-74-6, D-74-9, D-74-10, D-74-11 (Back after sign-out does not
restore the shell), D-74-51, D-74-64, D-30-7, D-16-2.

## Open questions

None.
