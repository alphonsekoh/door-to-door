# #225 · A failed Save changes in the amend sheet is said in view

- **Status:** In progress (branch `fix/225-amend-failure-in-view`, 7a97204 and 5a5ff04;
  no PR yet)
- **Phase:** 7 - Hardening
- **Depends on:** #213, #214

## Task

The amend sheet drew its `role="alert"` failure at the top of the form, and nothing
brought it into view. So at 32px, or with Add details open, a failed Save changes was said
above the visible part of the sheet (y −688 to −462 on an iPhone 13). Bring it into view
clear of the sheet's bar, and keep #214's refocus. UI only: `amend-visit-sheet.tsx` and its
test; `sheet.tsx` is untouched.

## Decisions

- **D-225-1 · The failure is drawn beside Save changes: last in the form, just above the
  `SheetActions` bar.** It is no longer at the top of the form. This follows D-33-29's and
  D-111-26's slot beside Save. _Why:_ it moves the form least from where Save is pressed.
  Pressed from Notes, it moved the form 82px at the default text and 242px at 32px,
  against 259 to 1509px for an alert at the top, and Save changes moved 0px. The top moves
  less only when Save is pressed from the top of a long form with details open (82px
  against 267 and 321px). _Research:_ R-217.
- **D-225-2 · It is outside the bar, unlike the record form's alert in `DockedActions`.**
  _Why:_ the bar is chrome-sized and pinned (D-111-60, D-136-1). A reader-sized failure is
  226px at 32px, and the team refusal is longer, so inside the bar it could make the bar
  taller than a small phone's sheet and lose its top past any scroll. Nothing in the bar
  is scrolled to either (D-214-9).
- **D-225-3 · One `scrollIntoView({ block: "nearest" })`, on the alert, in a layout effect
  when `failure` is set.** The body's `scroll-clear-sheet-actions` (D-136-3) keeps it clear
  of the bar. Save changes is not scrolled to, unlike D-213-1's alert-then-button pair.
  This applies D-195-1, D-164-7 and D-213-1 inside a sheet. _Why:_ the bar is always
  pinned in view, and D-214-9 skips it.
- **D-225-4 · The scroll runs after `useRefusalFocus`'s refocus.** The effect is declared
  below the hook, so Save changes gets focus back first, with `preventScroll`. The alert
  takes no focus. _Why:_ D-208-4, D-214-3 and D-214-5; D-214-2 leaves focus on the button.
- **D-225-5 · Only a failure appearing scrolls.** Nothing scrolls when the sheet opens
  (D-119-21), on success, or when a second try clears the alert. A second identical
  failure redraws the alert, so it is announced and scrolled to again. Applies D-213-3 and
  D-164-2. _Why:_ on a second try Save changes is under the thumb that pressed it.
- **D-225-6 · The form loses its bottom padding (`py-4` to `pt-4`), beyond the issue.**
  Like the other sheets with a bar, nothing sits under it, so a short sheet's bar now meets
  the sheet's foot. _Why:_ with the padding, the bar rested 16px higher at the end of the
  scroll than anywhere else. Bringing the failure in therefore dropped Save changes 16px,
  or 32px at 32px text. No test guards this: a class check would be hollow (verifier nit
  4). The code comment is the guard, so a later tidy-up must not put the padding back.
  _Research:_ R-217.
- **D-225-7 · The alert adds the home indicator's inset as its own scroll margin
  (`scroll-mb-[env(safe-area-inset-bottom)]`, 5a5ff04).** This fixes D-136's accepted
  safe-area known limit for this alert only. A focused field in any sheet can still end
  about 18px under the bar. _Why:_ the bar rests above the body's inset padding, which the
  scroll padding leaves out (R-184). So on an installed iPhone with details open the
  failure ended 17.6px under the bar; with the margin it ends 16px above. The margin is
  zero without an inset. If the shared fix lands in `scroll-clear-sheet-actions` (Open
  questions), remove it: it would be redundant, though harmless at the end of the scroll.
  _Research:_ R-218.
- **D-225-8 · No E2E.** Component tests and the verifier's device pass on both phones
  carry it, as with D-213-6. _Why:_ keep the suite thin (D-37-6). Playwright draws no
  inset and no on-screen keyboard.

## How existing decisions are handled

| Decision                  | Effect                                                                | By           |
| ------------------------- | --------------------------------------------------------------------- | ------------ |
| D-33-29, D-111-26         | Their slot beside Save is followed, outside the bar; record form kept | D-225-1, -2  |
| D-195-1, D-164-7, D-213-1 | Applied inside a sheet, with one scroll, the alert's                  | D-225-3      |
| D-208-4, D-214-2/3/5      | Kept: the refocus comes first, with `preventScroll`; no alert focus   | D-225-4      |
| D-213-3, D-164-2          | Applied                                                               | D-225-5      |
| D-119-21                  | Kept: the sheet still opens at its top                                | D-225-5      |
| D-136-3, D-214-9          | Unchanged: `sheet.tsx` is untouched                                   | D-225-3      |
| D-136's safe-area limit   | Fixed for this alert only (owner accepted the limit)                  | D-225-7      |
| #214's follow-up          | Closed: the amend sheet's failure is in view                          | D-225-1 to 5 |

## Evidence

- Verifier r1 at 5a5ff04: on both phones every case the issue names ends in view, 16px
  above the bar, and Save changes moves 0 to 0.5px. A key press leaves focus on Save
  changes. Each failure is one scroll step, and in 46 of 47 cases no frame drew the
  failure out of view first. On a simulated installed iPhone (34px inset), 10 of 10 cases
  end 16px above the bar. The E2E suite: 185 passed, 7 skipped.
- Bites, on mutated copies through a scratch Vitest alias with the worktree untouched
  (reviewer): with the scroll removed 4 tests fail, with the effect above
  `useRefusalFocus` 1 fails, and with the alert back at the top and the scroll kept 1
  fails. The verifier adds: `block: "end"` fails 1, the scroll put off a frame fails 3, and
  the margin removed fails 1 (a class check; jsdom has no `env()`). All 25 tests pass at
  7a97204 and at 5a5ff04.
- Not caught by a test (verifier nits 2 to 4): dropping the effect's `[failure]`
  dependency, which would pull the member back to the failure on every change;
  `useLayoutEffect` changed to `useEffect`, since jsdom's `act()` flushes both; and `pt-4`
  back to `py-4`.
- 7a97204 is unsigned because 1Password failed, which the owner allowed. 5a5ff04 is
  signed.

## Known limits

- At 32px on an iPhone 13 in the browser, the team refusal ("You are not on this record's
  team any more…", 322px) is taller than the 299px visible area. `nearest` shows its top,
  and its end sits 38.5px under the bar until the member scrolls (verifier r0 nit 3;
  R-212). It fits on the installed iPhone and on the Pixel 5.
- A second try clears the alert, so from the end of the scroll the form drops by the
  alert's height plus 16px (82px at the default text, 242px at 32px). Save changes stays
  put.
- Pressed from the top of a long form with details open, the scroll is longer than an
  alert at the top would need (D-225-1).
- Not measured: a real installed iPhone (the inset was simulated), the on-screen keyboard,
  VoiceOver and TalkBack.

## Follow-ups (owner)

Same class of bug as #225, out of its scope:

- `record-on-behalf-form.tsx:142-146` draws its failure at the top of the form, and
  nothing scrolls to it.
- `follow-up-sheet`, `promote-sheet`, `remove-follow-up-sheet` and `team-sheet` draw their
  alerts above the body with no scroll. #221's verifier saw failure lines out of view.
- A test that pins the effect's `[failure]` dependency (verifier nit 2): after a failure,
  change the interest and expect no second scroll.

## Relies on

D-33-29, D-37-6, D-111-26, D-111-60, D-119-21, D-136-1, D-136-3, D-164-2, D-164-7, D-195-1,
D-208-4, D-213-1, D-213-3, D-213-6, D-214-2, D-214-3, D-214-5, D-214-9.

## Open questions

- **The inset for every sheet.** Should `scroll-clear-sheet-actions` add
  `env(safe-area-inset-bottom)`, refining D-136-3 and closing D-136's accepted limit for
  every field, so D-225-7's margin comes off? Until then D-225-7 is a scroll offset in one
  component, which sits uneasily with D-111-5 ("Shared tokens, not one-off tweaks") as
  D-164-7 read it ("Shared, not a one-off offset"). If both stand nothing breaks: this
  alert clears the bar on an installed iPhone, and every other sheet's fields keep the
  18px limit.
