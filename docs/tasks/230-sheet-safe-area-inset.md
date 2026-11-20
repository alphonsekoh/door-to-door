# #230 · A sheet's room under its bar counts the home indicator

- **Status:** Done (PR #237)
- **Phase:** 7 - Hardening
- **Depends on:** #136, #225, #227

## Task

On an installed iPhone, a field or failure a sheet scrolled into view ended about 18px
under its `SheetActions` bar: the bar rests above the body's inset padding, and the
body's scroll padding left the inset out (R-184). #136 accepted this as a known limit and
#225 fixed it for the amend sheet's failure alone. The owner ruled on 2026-11-20 to make
the shared fix here. CSS and one E2E; `sheet.tsx`, the bar and D-214-9's skip are
untouched.

## Decisions

- **D-230-1 · `scroll-clear-sheet-actions` adds `env(safe-area-inset-bottom)`: the bar's
  measured height, plus the inset, plus 16px.** Every sheet with a bar brings a field or
  failure 16px clear of the bar where it rests. Refines D-136-3 and closes D-136's
  safe-area known limit, with D-227-2's typing case. _Why:_ scroll padding counts from
  the scrollport's edge, below the inset padding the bar sits on (R-184). It is one
  shared utility, not a one-off (D-111-5, D-164-7), and `env()` is 0 wherever there is
  no inset, so nothing measured in the browser by #136, #164, #213, #214, #225 or #227
  moves. _Research:_ R-184, R-218, R-221.
- **D-230-2 · A sheet with no bar keeps 16px plus the inset.** In the browser that is
  D-136-3's 16px; installed, with an iPhone 13's 34px inset, it is 50px
  (`ConfirmDialog`, `NotSavedDialog`). Refines D-136-3. _Why:_ the utility is shared, and the room keeps
  what is scrolled to clear of the home indicator, as `scroll-clear-chrome` does for a
  page. No sheet without a bar has a text field, and neither scrolls at the sizes
  measured, so nothing moved.
- **D-230-3 · The amend sheet's alert loses D-225-7's own scroll margin.** Supersedes
  D-225-7 (owner, 2026-11-20). Its two class-only checks in `amend-visit-sheet.test.tsx`
  go with it. _Why:_ a target's scroll margin adds to its scroller's scroll padding
  (R-218), so keeping both would count the inset twice. With the shared padding the
  failure lands where D-225-7 put it, 16px above the bar. This ends the one-off against
  D-111-5 that the owner had accepted until #230. _Research:_ R-218.
- **D-230-4 · One E2E, "with a home indicator" in `large-text.spec.ts`, and no jsdom
  test.** It reuses R-218's simulation: service workers blocked, and every
  `env(safe-area-inset-bottom)` served as 34px. It first checks the body's padding is
  34px, so an unchanged stylesheet cannot pass. Then "Go back by (optional)" in Suggest a
  return visit at 32px must end 16px above Send; without the fix it ends 18px under on
  both engines. The browser test "… keeps a field clear of all of it" (bar plus 16px) is
  unchanged and now also guards the zero-without-an-inset case. Extends D-136-12. _Why:_
  jsdom has no `env()` or layout, so a Vitest check could assert only a class name
  (D-225-6). The simulation is one route and about 1s a phone (D-37-6).
- **D-230-5 · The E2E brings the field in with `scrollIntoView({ block: "nearest" })`,
  not by focusing it.** That is the call the sheet's focus handler and the amend failure
  make. _Why:_ focusing a field out of view scrolls it toward the middle first, which
  here reaches the end of the scroll, so a focus-based test passed without the fix.
  WebKit did so for this date field even with `preventScroll`. _Research:_ R-223.

## How existing decisions are handled

| Decision                | Effect                                                                      | By          |
| ----------------------- | --------------------------------------------------------------------------- | ----------- |
| D-136-3                 | Refined: the padding adds the inset; a sheet with no bar keeps 16px plus it | D-230-1, -2 |
| D-136's safe-area limit | Closed for fields, the amend failure and typing, in every sheet             | D-230-1     |
| D-225-7                 | Superseded (owner): the shared padding replaces the alert's own margin      | D-230-3     |
| D-111-5, D-164-7        | Kept: one shared utility; D-225's accepted one-off is gone                  | D-230-1, -3 |
| D-227-2                 | Its installed case fixed: 0 of 150 keystrokes under the bar, was 81         | D-230-1     |
| D-227-3                 | Unchanged: the note's foot under Send at 32px in an iPhone's browser        | -           |
| D-214-9, D-119-21       | Unchanged: `sheet.tsx` is untouched                                         | -           |
| D-225-6                 | Applied: no class-only check                                                | D-230-4     |
| D-136-12                | Extended: an installed check beside the sheet's padding check               | D-230-4     |

## Evidence

- Builder at 0f907ff (signed): with the CSS reverted the new test ends at −18px on both
  phones; restored, 16 (15.94 on Chromium, 16.0 on WebKit). Native E2E 187 passed, 7
  skipped (185 before; the test adds one a phone).
- Verifier r0 at 0f907ff, production build, simulated installed (393x851 and 390x844,
  34px) and in the browser, at the default text, 28 and 32px:
  - Installed, every bar sheet measured (amend, Suggest, Add to the follow-up list,
    Record on behalf) ends 15.8 to 16.45px above the bar; main was 17.5 to 18.2px under.
  - The amend failure from Notes ends 15.8 to 16.5px above, where D-225-7 put it, and
    Save changes moves 0 to 0.44px.
  - D-227-2's check: 0 of 150 keystrokes under the bar (main 81 of 150, in all 8 cases),
    the caret at least 15.45px above Send.
  - In the browser 117 of 128 cases match main to the pixel; 11 differ by 0.02 to 0.9px,
    each in a sheet still settling.
- Bites (verifier): the fix removed fails the new test (−18); a fixed 34px in place of
  `env()` fails the browser test (50); the inset counted twice passes both (Known limits).
- Reviewer r0: no sheet passes a bottom padding through `bodyClassName` (only `pt-4`),
  and no `scroll-clear-chrome` or `scroll-clear-nav` element renders inside a sheet, so
  nothing stacks a second inset on the padding.

## Known limits

- Installed, a sheet's content scrolls through the 34px strip below the bar, where the
  home indicator sits: Notes' text, and at 32px "Go back by", are drawn under Send
  (#227's planner, verifier nit 1). That is the sheet's structure, out of #230's scope.
- The new E2E cannot catch the inset counted twice. Its field is the last above the bar
  and the body ends at the end of its scroll, where the field rests 16px above whatever
  the padding (verifier nit 3). A field ending mid-scroll, such as Suggest's note at
  390x844, would pin both. A doubled inset would leave a field 50px clear, not under.
- D-227-2's typing and the amend failure are covered by the verifier's device pass, not
  by a test.
- The built CSS still has a rule for D-225-7's class: Tailwind scans `docs/`, and
  D-225-7's text names it. No element uses it.
- Not measured: a real installed iPhone (the inset was simulated), the on-screen
  keyboard, VoiceOver and TalkBack.

## Follow-ups (owner)

- The 34px strip below the bar (Known limits), if a change to the sheet's structure is
  wanted.
- Not a sheet, and the same on main (verifier nit 2): on the record page, a focused Notes
  in Add details is not brought clear of the docked Save. Tapped with its top 24px above
  the bar, it stays 66 to 154px under; installed, Tab from Religion leaves it under the
  nav. The page has no focus scroll like a sheet's.

## Relies on

D-37-6, D-111-5, D-119-21, D-136-1, D-136-3, D-136-12, D-164-7, D-214-9, D-225-3,
D-225-6, D-227-2, D-227-3.

## Open questions

None. The owner settled the shared fix on 2026-11-20 (D-225's open question), and the
issue names D-136-3's refinement.
