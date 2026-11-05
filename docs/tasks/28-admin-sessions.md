# #28 · Admin session management

- **Status:** Done (PR #66)
- **Phase:** 5 - Admin UI
- **Depends on:** #17, #18

## Task

Outing list and detail: create, attach blocks, start, end, reopen.

## Decisions

- **D-28-1 · Reopen is on the list row and never confirms.** _Why:_ a locked-out member
  is waiting.
- **D-28-2 · Ending and detaching confirm, and say what they cost.**
- **D-28-3 · A clashing start is not pre-checked client-side.** The server's message is
  shown. _Why:_ check-then-act races. Relies on D-17-2.
- **D-28-4 · Blocks can be registered inline from the attach sheet.**
- **D-28-5 · Members get a `404` on admin pages (`requireAdminPage`), not a redirect.**
  Affordance only; D-16-2 still applies. _Refined by D-125-17:_ a request with no live
  sign-in is sent to `/sign-in?reason=signed-out`; members still get the `404`.
- **D-28-6 · No `window.confirm`; an in-page `alertdialog`.**
- **D-28-7 · Async lists guard against stale responses** with a generation counter.
