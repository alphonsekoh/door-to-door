# #208 · A refused sign-in drops focus to the page

- **Status:** Done (PR #211)
- **Phase:** 7 - Hardening
- **Depends on:** #151, #187

## Task

A sign-in form test found focus on `<body>`, not Sign in, once in a full coverage run,
and passed alone. The cause is in the form, not the test: Sign in and Sign in with Google
are disabled while an attempt is out, and a browser moves focus off a disabled control to
the page. The form now gives it back after a refusal. Built in 70d0622 and 13600f6; only
`src/components/account/sign-in-form*` changed.

## Decisions

- **D-208-1 · The form is fixed, not only the test.** _Why:_ the test was right. In a
  browser a refused press left focus on the page every time on Pixel 5 (R-200), and a
  test made to expect `<body>` would pin the drop D-85-15 already refused on sign-out.
- **D-208-2 · Both buttons stay `disabled` while an attempt is out, and a refusal puts
  focus back.** This extends D-85-15's refocus to sign-in and Sign in with Google. The
  sign-out screen's unconditional refocus is unchanged. _Why:_ D-156-2's reason holds:
  the dim and press rule key on `:disabled`, and the browser ignores a second tap with no
  script.
- **D-208-3 · Focus goes back only to the button the press focused, and only if focus is
  on `<body>` when the refusal is drawn.** The press notes `document.activeElement`, if
  it is a button, before anything is disabled. Go from the password field keeps focus
  there. An iPhone tap focuses no button, so focus stays on the page as before. _Why:_
  give back only what the browser took. _Extended by D-214-2 and D-214-3 (owner,
  2026-11-19):_ the app-wide rule for a busy-disabled button, through `useRefusalFocus`.
- **D-208-4 · The refocus uses `focus({ preventScroll: true })`, in the refusal's layout
  effect, before its `scrollIntoView`.** _Why:_ a plain `focus()` scrolls to the button,
  and the page must move only as far as the message needs (D-151-7, D-151-10).
- **D-208-5 · Sign in with Google is covered too.** Its refusal is a `signIn` that throws
  before leaving (D-14-6's "didn't finish"). This does not conflict with D-151-6, which
  scoped only the CSRF resend out of Google. _Why:_ "Opening Google…" is disabled and
  drops focus the same way (R-200).
- **D-208-6 · The focus tests hold the refusal past one animation frame and assert focus
  is on `<body>` before they refuse and assert it came back.** `nextFrame()` waits for a
  `requestAnimationFrame`, which jsdom runs in the same tick as its focus fixup (R-199),
  so it waits for an event, not a time. No retries, sleeps or longer timeouts (D-88-4,
  D-192-1). _Why:_ the issue's test passed or failed by timing. With the premise asserted,
  it fails every time without the fix, and it shows the drop is real. `nextFrame()` is
  in `test/next-frame.ts` since D-214-7.
- **D-208-7 · Focus the member moves while the attempt is out stays where they put it
  (13600f6).** "stays where the member put it while the attempt was out" pins it. It is
  the only test that fails when the `activeElement === body` check is dropped. _Why:_ a
  member who goes back to fix a typo keeps the keyboard. Without this test, the check
  could be dropped and all 49 tests still passed (reviewer r0).
- ~~**D-208-8 · Scope cut: no E2E pins the refocus.** The browser check was a manual
  Playwright probe on a production build (R-200). _Why:_ `e2e/` was outside this issue's
  files.~~ Superseded by D-214-6.

## Cause

The issue guessed jsdom 30, where only removing the focused element moves focus. The repo
has been on jsdom 31 since #187 (PR #198). jsdom 31 runs the HTML focus fixup at its
60 Hz rendering update, so it also moves focus off a control that became disabled
(R-199). The mocked refusal usually landed within a frame, while Sign in was still
enabled. Under load, a frame landed while it read "Signing in…". The button never left
the DOM.

The builder checked the file's other reads straight after a `findBy`. Each reads state
drawn in the same commit as what it found, because a refusal batches
`setSubmitting(false)` or `setLeaving(false)` with `setFailure`. None has this shape.

## Evidence

- **Before:** the test's flow repeated 200 times beside a full `npm test` failed 7
  times, each blur from jsdom's `focusFixup`. The unchanged file passed 20 of 20: the
  flake was too rare to show at file level. A refusal answered after 40 ms failed every
  time.
- **Bites** (form broken, tests run, form restored):
  - main's form, with no refocus: 2 fail, the issue's test with its exact message and
    the Google test;
  - focus moved to Email on a refusal: 4 fail;
  - Sign in focused whenever focus is on the page: the iPhone and Google tests fail;
  - Sign in always focused: the Go, iPhone and Google tests fail;
  - with the `activeElement === body` check dropped, only D-208-7's test fails.
- **After:** the 200-repeat flow passed 200 of 200. The file passed 20 of 20 beside 3
  full `npm test` runs at load 366 to 415 (70d0622), and again 20 of 20 at load 118 to
  172 (13600f6). Reviewers r0 and r1 each ran the file 5 of 5 under load.

## How existing decisions are handled

| Decision | Effect                                                                                 | By      |
| -------- | -------------------------------------------------------------------------------------- | ------- |
| D-151-7  | Refined: "focus stays on Sign in" never held in a browser for a refusal past a frame   | D-208-3 |
| D-85-15  | Extended to sign-in and Google, made conditional; sign-out is unchanged                | D-208-2 |
| D-156-2  | Its reason applied: `disabled` kept                                                    | D-208-2 |
| D-151-10 | Kept: `preventScroll`, so the page moves no further than the message needs             | D-208-4 |
| D-151-6  | Unchanged: it scoped only the CSRF resend out of Google                                | D-208-5 |
| R-43     | Superseded by R-199: true of jsdom 30.0.1 only                                         | R-199   |
| R-189    | Amended by R-199: jsdom 31's async focus move did affect a test, and showed a real bug | R-199   |

## Follow-ups (owner)

Outside this issue's files, so not changed here:

- The comment at `src/components/shell/auth-failure-screen.test.tsx:157` ("jsdom keeps
  focus on a disabled control") is false under jsdom 31 (R-199).
- 15 other test files assert `toHaveFocus`. Any that reads focus on a control that stays
  disabled across an async gap can flake the same way. They have not been audited.
- ~~D-33's known limit (Save drops focus to `<body>`) can now be pinned in jsdom the same
  way.~~ Fixed and pinned by #214 (D-214-2, D-214-7).
- ~~Account's Sign out is also disabled while signing out, and D-164-1 moves no focus, so a
  refused sign-out there likely ends on the page too. This is read from the code, not
  measured.~~ Measured and fixed by #214 (R-213, D-214-2).
- ~~An E2E for the refocus (D-208-8).~~ Added by #214 (D-214-6).

## Relies on

D-14-6, D-85-15, D-88-4, D-151-6, D-151-7, D-151-10, D-151-11, D-156-2, D-164-1,
D-192-1.

## Open questions

None. No decision conflicts with an accepted one. The follow-ups above are for the owner
to file or not.
