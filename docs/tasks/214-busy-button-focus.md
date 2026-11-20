# #214 · A failed press on a busy-disabled button gives focus back

- **Status:** Done (PR #224). The owner ruled option B on 2026-11-19 (D-214-2).
- **Phase:** 7 - Hardening
- **Depends on:** #208, #213

## Task

A button `disabled` while its request is out loses focus to the page, and a refusal left
it there, so a keyboard member started again from the top. #211 fixed this on sign-in
only (D-208-3). Measure it elsewhere, have the owner set the scope, and pin sign-in's
refocus in a real browser (D-208-8). UI only: no contract, schema or server change. Built
in 9828c3c, 210bf9b and 99c37d0.

## Decisions

- **D-214-1 · Measured before fixing.** At every place measured, a failed press that
  focused its busy-disabled button ended with focus on `<body>`: on a Pixel 5 after any
  press, on an iPhone 13 after a key press. A WebKit tap or click focuses no button, so
  focus stays where it was, on the page or on a sheet's panel. How soon focus drops
  varies, so a test waits for the drop rather than counting frames. _Why:_ the issue's
  step 1; the drop is the browser's, not any one screen's. _Research:_ R-213.
- **D-214-2 · Giving focus back is the app-wide rule for a failed press on a
  busy-disabled button (owner, 2026-11-19, option B).** #214 fixes the places measured
  and the presses that share their handlers: Sign in, Account's Sign out and Sign out
  anyway, the record form's Save, the amend sheet's Save changes, Start, End and Reopen,
  and Team's Make an admin or member, Reactivate and Deactivate. #221 sweeps the rest.
  Supersedes D-33-29's "focus stays where the disabled button dropped it" and D-33's
  matching known limit. Refines D-164-1's and D-213-4's "focus is not moved" to "the
  alert takes no focus", which the code comments now say. _Why:_ the cause is the
  browser (R-213), so a rule per screen would leave the drop everywhere else; about 25
  components in one PR is too heavy a review.
- **D-214-3 · One hook, `useRefusalFocus` (`src/lib/hooks/use-refusal-focus.ts`); sign-in
  moves onto it unchanged.** `notePress()` at the press keeps the button it focused, if
  any. `refused()` bumps a counter whose layout effect focuses that button with
  `preventScroll`, only if focus is on `<body>`, then forgets it. Both are stable
  (`useCallback`). `refused()` must run in the same tick as the update that re-enables
  the button, as every caller here does, in the same `catch` or its `finally`: a caller
  that awaited between them would focus a disabled button and lose the press. _Why:_
  D-208-2 to D-208-4 and D-208-7 in one place, not six copies. A counter, not the
  message, because the record form's off-list refusal can repeat with nothing changed.
  _Refined by D-221-5 and D-221-6:_ one `await` on a settled promise may sit between
  them, never I/O, and a button re-enabled in a transition is refused inside it.
- **D-214-4 · `<body>` is the only check, in a sheet too.** _Why:_ everything outside the
  top modal is inert (D-90-7), so the page is the only place outside one that focus can
  fall to. The check never pulls focus out of a pop-up opened on top, and leaves a WebKit
  tap's focus on the sheet's panel (D-90-2).
- **D-214-5 · The press is noted on the page's own control, never in a confirm, and the
  hook sits above the place's failure scroll.** End, Deactivate and Sign out anyway are
  noted on End, Deactivate and Sign out. On those three paths the hook's focus lands
  while the page is still inert and does nothing: D-90-9's return does the work, onto
  the same button (measured on both phones). Deactivate's `notePress()` stays anyway
  (reviewer), so every busy-disabled press is noted at its own control and #221 stays
  mechanical. Focus is back before the Sessions and Team scrolls (D-213-1, D-213-2).
  Where a server `400` opens Not saved, the pop-up now opens from Save, not the page; its
  OK still sends focus to the field (D-119-15). The record form names the hook's
  `refused` `saveRefused`; Account keeps the result whole as `signOutFocus`, since Save
  name (#221) will want its own. _Why:_ a confirm's button leaves with its dialog.
  _Refined by D-221-4:_ on a member's Sign out everywhere, D-90-9's return finds the
  button still disabled, and the hook gives focus back once the list is read again.
- **D-214-6 · An E2E pins sign-in's refocus with a key press, refused by the server for
  real.** Supersedes D-208-8. In `e2e/auth.spec.ts`, "with a wrong password" (service
  workers blocked) presses Sign in with Enter and holds the request until "Signing in…"
  is disabled and `expect.poll` sees focus on `<body>`. The route matches
  `url.pathname === "/api/auth/callback/credentials"`, not the plan's glob, because
  Auth.js posts it with a query string. The alert is looked for inside `main`, as Next's
  route announcer is an alert too. _Why:_ a key press focuses the button on both
  engines, so one assertion with no branch; the drop can take more than three frames, so
  it polls (D-88-4, D-192-1). _Research:_ R-213, R-216, R-177.
- **D-214-7 · No other E2E; each place gets D-208-6 component tests, and `nextFrame()`
  moves to `test/next-frame.ts`.** Beyond the plan the builder added the record form's
  direct `POST` and session-unknown refusals, Reopen, Reactivate, End's and Deactivate's
  confirms, and that focus is back before each scroll on Sessions and Team. The three
  confirm-path tests (Sign out anyway, End, Deactivate) check only where focus ends:
  jsdom has no `inert`, so taking the hook off those paths fails none of them, and the
  device pass covers them. Sign-in's 51 tests pass unchanged. _Why:_ D-37-6; jsdom 31
  runs the focus fixup (R-199).
- **D-214-8 · Refusals only.** A successful press that leaves its button on screen
  ("Save and next") can also drop focus if it takes over a frame. Not measured, not in
  this issue. _Why:_ the issue and the ruling are about refusals.
- **D-214-9 · A sheet's body no longer scrolls to a control in its `SheetActions` bar
  (99c37d0).** The bar is marked `data-sheet-actions`, and the body's focus scroll skips
  a target inside it. This reaches all ten sheets with a bar, not only the amend sheet: a
  press or key that focuses a primary action no longer moves the form by up to the bar's
  height (84px at 32px). A field still comes clear of the bar. Refines D-111-31, D-136-3
  and D-196-5; D-119-21's reset to the top is unchanged. Only `Sheet` changed, so the
  other sheets' busy handling is still #221's. _Why:_ the refocus fired the body's focus
  scroll, and the padding that clears the bar counts the bar as covered: the amend form
  moved 84px at 32px, and on an iPhone with a keyboard the failure went under the header
  (verifier r0). Safe because every bar is the last child of the body, or of a form that
  is, so it is always pinned in view, and only buttons in it take focus. _Research:_
  R-215.
- **D-214-10 · The stalled-outing record form test fakes only `setTimeout` and
  `clearTimeout` (9828c3c).** _Why:_ faking every timer started jsdom's frame and focus
  fixup interval under the fake clock; after it, no later test in the file drew a frame
  or dropped focus, and the first #214 test after it hung. _Research:_ R-214.

## How existing decisions are handled

| Decision                   | Effect                                                                     | By          |
| -------------------------- | -------------------------------------------------------------------------- | ----------- |
| D-33-29                    | Focus clause and D-33's known limit superseded (owner); D-119-15 unchanged | D-214-2     |
| D-164-1, D-213-4           | Refined: the alert takes no focus; the button gets it back from the page   | D-214-2, -5 |
| D-208-8                    | Superseded: an E2E pins the refocus                                        | D-214-6     |
| D-208-2 to -4, D-208-7     | Extended app-wide, in one hook                                             | D-214-3     |
| D-208-6                    | Applied at each place; `nextFrame()` shared                                | D-214-7     |
| D-90-9                     | Unchanged; on the three confirm paths it is what gives focus back          | D-214-5     |
| D-119-15                   | Unchanged: Not saved now opens from Save, and OK still goes to the field   | D-214-5     |
| D-213-1, D-213-2           | Kept: focus is back before their scrolls                                   | D-214-5     |
| D-111-31, D-136-3, D-196-5 | Refined: a control in the bar is not scrolled to                           | D-214-9     |
| D-119-21                   | Unchanged: a sheet still opens at its top                                  | D-214-9     |
| D-85-15                    | Unchanged: the sign-out screen keeps its unconditional refocus (D-208-2)   | —           |
| R-200                      | Its "no E2E pins it" closed                                                | D-214-6     |

## Evidence

- Verifier r1, at 99c37d0: 67 of 67 device cases a phone (Pixel 5 and iPhone 13, key and
  tap, default text and 32px), and the E2E suite at 185 passed, 7 skipped. r0's six
  failures, all the amend sheet's jump (D-214-9), are gone.
- Bites: dropping any place's `refused()`, the hook's `<body>` check, its
  `preventScroll` or its forgetting, the Sheet's skip or its marker each fail a test.
  The E2E fails on both phones without the password refusal's `refused()`. Only
  Deactivate's `notePress()` is not caught (D-214-5, D-214-7).
- All 342 tests in the eight changed test files pass (reviewer).

## Known limits

- After an iPhone tap on a confirm path focus ends on the page: the tap focused no
  button, so D-90-9's opener was the page. As on main.
- VoiceOver and TalkBack were not measured.

## Follow-ups (owner)

To file or fold into #221:

- Six component test files still call `vi.useFakeTimers()` with nothing passed:
  `block-attach-sheet.test.tsx` (lines 51 and 65), `outing-team.test.tsx:656`,
  `active-session`, `session-detail`, `admin-records` and `offline-shell`. A D-208-6
  test placed after one of them hangs (R-214). `block-attach-sheet` and `outing-team`
  are on #221's list, so #221 should narrow `toFake` there first. Done there by #221
  (D-221-3); the other four are #215's.
- A successful press can drop focus the same way (D-214-8).
- ~~Already on main, seen by the verifier: the amend sheet's failure is drawn at the top
  of the form and nothing brings it into view, so at 32px, or with Add details open, it
  can sit above the visible part of the sheet.~~ Fixed by #225 (D-225-1 to D-225-5).
- Already on main: after End is refused because the session ended elsewhere, Admin
  Sessions still shows "Running now" and End session beside "already ended" until a
  refresh. _Fixed by #226 (D-226-1 to D-226-3)._
- Already on main: on an iPhone at 32px, "Suggest a return visit"'s note box is taller
  than the room above Send and ends 22px under the bar.

## Relies on

D-37-6, D-85-15, D-88-4, D-90-2, D-90-7, D-90-9, D-119-15, D-119-21, D-192-1, D-208-2,
D-208-3, D-208-4, D-208-6, D-208-7, D-213-1, D-213-2.

## Open questions

None. The owner ruled the scope (option B) on 2026-11-19; nothing in the change
contradicts an accepted decision beyond what that ruling changes.
