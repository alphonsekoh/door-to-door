# #176 · The #155 probe in the real engines

- **Status:** In progress (no PR yet), with #186 on one branch
  (`test/176-186-block-screen-guards`)
- **Phase:** 7 - Hardening
- **Depends on:** #155

## Task

Only jsdom guarded #155's fix (D-155-4): the follow-up spec passed with the fix reverted.
Put the #155 verifier's deterministic probe into the E2E suite, so the block screen's
first answers land inside the unit field's `input` event on both phone projects, with no
waits. Tests only. Built in commit 58f3b83.

## Decisions

- **D-176-1 · The probe is folded into the existing listed-household test.** "A member
  records only the households on a follow-up session's list"
  (`e2e/follow-up-session.spec.ts:111`, `:56` before) now holds the answers and checks
  the unit is kept. No new test, spec or flow. _Why:_ D-37-6; that test already reaches
  the block screen by client navigation and fills `#09-999`.
- **D-176-2 · The hold is a page init script; a window capture `input` listener on the
  unit field releases it.** `addInitScript` wraps `window.fetch`, and the field's first
  `input` event lets the held answers go. Nothing is inlined in the app. _Why:_ the
  release must run inside the event, so the hold has to be in the page. A window capture
  listener runs before React's, so the answers land after the field has changed and
  before React reads it, as WebKit can (R-151). Inline script would break the CSP, and a
  violation fails the test (D-122-8). The fixtures install their sweeps the same way
  (D-117-64).
- **D-176-3 · Answers are held by page, not by count.** Only `/api/sessions/active` and
  `/api/households` answers asked for on `/blocks/`, answered `ok`, and before the
  release are held. _Why:_ the Session screen asks for `/sessions/active` too, and polls
  it every 30 s (D-24-2), so a count could hold its answers instead.
- **D-176-4 · Each answer is read in full before it is held.** Its `json()` is replaced
  by a promise already resolved with the body. _Why:_ after the release nothing waits on
  I/O, so all of the answer's code runs inside the event.
- **D-176-5 · The page records `held` and `released` in `sessionStorage`, and the test
  asserts both.** It polls for "held session, units" before the fill, and expects
  "released session, units" right after it. _Why:_ a probe that held nothing, or released
  outside the fill, would otherwise pass as fixed. The poll waits for a state, not a
  time, so no wait is added.

## Evidence

- **With the fix:** kept 10 of 10 on Chromium and 10 of 10 on WebKit (builder and
  verifier). The whole follow-up spec, and the full suite, pass on both (one rerun of a
  test that ran across a machine sleep).
- **With every `startTransition` in `block-screen.tsx` a plain call:** kept 0 of 10 on
  each engine (builder), 0 of 20 (verifier). Every run failed at `:142` with `#05-123`,
  after the held and released checks had passed.
- **CSP:** the fixtures saw no violation from the init script (D-122-8).
- All of it ran on macOS. CI's Linux WebKit is its first run there.

## Known limits

- Only the first page of units is held. Later pages are asked for after the release, so
  they land outside the fill. The test's block has one page.
- A failure at `:139` or `:141` means the hold did not take; one at `:142` is #155
  itself.
- It uses `fill`, which fires no `keydown` or `paste`, so D-155-6 still stands.
- New session has no such probe; its guards stay jsdom only (D-171-5).

### How existing decisions are handled

| Decision | Effect                                                             | By           |
| -------- | ------------------------------------------------------------------ | ------------ |
| D-155-4  | Extended: the in-engine probe is now in `e2e/` (owner, 2026-11-12) | D-176-1      |
| D-37-6   | Kept: one existing test extended, no new flow                      | D-176-1      |
| D-122-8  | Kept: the hold is an init script, nothing inline                   | D-176-2      |
| D-24-2   | Kept: the Session screen's poll is why answers are held by page    | D-176-3      |
| D-171-5  | Narrowed: only New session's probe is still outside `e2e/`         | Known limits |

## Relies on

D-24-2, D-37-4, D-37-6, D-117-64, D-122-8, D-155-1, D-155-2, D-155-4, D-155-6.

## Open questions

None.
