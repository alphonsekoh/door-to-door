# #232 · A failure in the rest of the sheets and forms is said in view

- **Status:** In review (PR #239)
- **Phase:** 7 - Hardening
- **Depends on:** #213, #221, #225, #226, #230

## Task

#213 and #225 brought a failure into view at their places; #221's and #225's verifiers
found the rest still said out of view. In sheets, the alert sat atop the body and nothing
scrolled to it: up to 1329px above the view for Record for a member and 2529px for Add
households. On pages, a failure pushed its button under the install hint or banner. Apply
D-225-1 to D-225-5 in sheets and D-213 / D-195-1 on pages. UI and tests only.

## Decisions

- **D-232-1 · In eight sheets the failure is drawn beside the primary action, last in the
  body, just above the `SheetActions` bar and outside it, and scrolled to with one
  `nearest` after `useRefusalFocus`.** Record for a member, Add blocks, Add households,
  the follow-up, promote and Remove/Dismiss/Withdraw sheets, the team sheet and the
  admin's team sheet. The follow-up and promote sheets' half-done line (D-117-46) moves
  with the failure and has its own scroll, so each failed retry brings it back (D-221-7).
  No alert takes focus or adds an inset margin (D-230-3). Applies D-225-1 to D-225-5.
  _Why:_ the issue; the amend sheet's measured placement (R-217).
- **D-232-2 · The admin's "New team" sheet (`admin-team-sheet.tsx`) is included, beyond
  the issue's list.** _Why:_ it is the team sheet's twin, and on main its failure was 635
  to 689px above the view at 32px on both phones.
- **D-232-3 · One hook, `useFailureInView(failure, redrawn = 0)`
  (`src/lib/hooks/use-failure-in-view.ts`), at ten places.** It returns the ref for the
  alert, or for a block holding it, and scrolls only while `failure` is not null. The five
  inline copies (amend sheet, Account, member page, member list, Sessions) are left as
  they are. _Why:_ ten places would otherwise copy one effect (the task's rule of three);
  leaving the five keeps the sweep small.
- **D-232-4 · `SheetActions` also measures its bar in a layout effect on every render.**
  It runs ahead of the sheet's own layout effects; the `ResizeObserver` stays for a
  text-size change that draws nothing. Refines D-136-3's mechanism. _Why:_ offline, a
  team sheet gains its "Connect to change…" note in the same commit as the failure. The
  observer answers after the sheet's scroll, which then used the old bar: the failure
  ended 32px under the bar at 32px. A child's layout effects run before its parent's.
  _Research:_ R-224.
- **D-232-5 · Add blocks' failure is `{ at: "list" | "actions", message }`, as in
  `member-detail.tsx` (D-213-2).** A failed listing stays by the search and scrolls
  nothing; a failed Attach or Add to the registry, or its empty-field check, is said
  beside the actions and scrolled to. _Why:_ a listing fails on open or as a search
  lands, where nothing may scroll (D-225-5, D-119-21).
- **D-232-6 · A revisit row's block of failure and Mark done becomes `scroll-clear-nav`
  and is scrolled to with `nearest`.** The alert stays above Mark done, Team's layout.
  Applies D-213-2 and D-195-1. _Why:_ the failure pushed Mark done 63 to 290px under the
  install banner or the nav; it now ends 12 to 24px above.
- **D-232-7 · Create draft's failure moves under the button, and the button, why it
  waits and the failure are one `scroll-clear-nav` block with one `nearest` scroll.**
  D-195-1's block, not D-213-1's alert-then-button scrolls. _Why:_ D-213-1 split the
  scroll because its block held the row's title; this one holds none, and where it is
  too tall both keep the button's top (R-212). Under the button, as on the Sessions list
  below it, a second try leaves Create draft where it was. On main the button ended 11 to
  74px under the banner, and at 32px the failure about 1150px above.
- **D-232-8 · Create draft and Add households bring a kept failure into view again after
  every re-read a refusal sets off.** A counter passed as `redrawn` goes up as each read
  is drawn. Create draft bumps it in the transition that calls `refused()` (D-221-6,
  D-221-15), so focus is back first. Refines D-213-3 for these two places. Unlike
  D-226-4, it does not wait for a change of action. _Why:_ Create draft's re-read always
  redraws the households above the button, pushing the block 769 to 2489px below the
  foot. Add households' re-read can put "Tick the households to add." in Add's bar,
  which grows over the failure. While the failure is still in view, `nearest` moves
  nothing.
- **D-232-9 · No E2E.** Each place has component tests that fail with the scroll
  removed, the alert back at the top, or the hook above `useRefusalFocus`.
  `scroll-clear-nav` is asserted only beside the scroll (D-225-6). _Why:_ D-225-8 and
  D-213-6; ten places would not keep the suite thin (D-37-6). The verifier's device pass
  covers the layout.

## How existing decisions are handled

| Decision                     | Effect                                                                | By              |
| ---------------------------- | --------------------------------------------------------------------- | --------------- |
| D-225-1 to D-225-5           | Applied to eight sheets                                               | D-232-1, -2     |
| D-230-1, D-230-3             | Kept: the inset comes from the body's padding, no alert margin        | D-232-1         |
| D-208-4, D-214-3, D-221-1    | Kept: the hook is declared below `useRefusalFocus`; alert takes none  | D-232-1, -3     |
| D-136-3                      | Refined: the bar also measures on every render                        | D-232-4         |
| D-213-2, D-195-1, D-164-7    | Applied to the revisit row and Create draft                           | D-232-6, -7     |
| D-213-1                      | Not applied to Create draft: its reason was the title, here absent    | D-232-7         |
| D-213-3, D-164-2             | Refined: a refusal's re-read scrolls again at two places              | D-232-8         |
| D-226-4                      | Unchanged on Sessions; its reason, not its trigger, followed          | D-232-8         |
| D-221-6, D-221-15            | Kept: Create draft's `loadList({ afterRefusal })` refocus comes first | D-232-8         |
| D-119-21, D-225-5            | Kept: nothing scrolls on open, on success, or a listing's failure     | D-232-5         |
| D-225-6, D-225-8, D-213-6    | Applied: no class-only check, no E2E                                  | D-232-9         |
| #221's and #225's follow-ups | Closed: the sheets and pages they listed say their failure in view    | D-232-1, -6, -7 |

## Evidence

- Builder at 3833648 (signed): on both phones at the default text and 32px every listed
  place was out of view on main and is in view, 16px clear of the bar (9 to 16px for the
  team sheets offline), except the known limits below. `test:coverage` 284 files, 5145
  tests; native E2E 187 passed, 7 skipped, as #230.
- Verifier r1 at 78ee394, PASS: 276 readings on both phones, by a `500`, a dropped
  connection and real refusals. Bar buttons moved 0 to 0.5px, the alert never took
  focus, nothing scrolled on open or on success. Simulated installed iPhone: every
  failure 16 to 16.5px above the bar, the inset counted once. 8 of 8 mutations failed
  tests. E2E 187 passed, 7 skipped.
- Reviewer, on a scratch copy outside the worktree: the 12 changed test files pass (262
  tests). The hook's scroll removed fails 30; the hook above `useRefusalFocus` in the team
  sheet fails 1; `SheetActions`' per-render measure removed fails 1; Create draft's
  counter removed fails 1; Add households' counter removed fails 2. No domain,
  authorization, contract or server code is touched.

## Known limits

- At 32px on an iPhone 13, the follow-up and promote failure (226px in 199px of room)
  keeps its top and ends 42.5px under the bar, as D-225's team refusal does (R-212).
- At 32px the half-done line (322px) is taller than the room on both phones: it ends
  16px clear of the bar (16px under in one builder run), its top 53 to 85px (Pixel 5) or
  139px (iPhone 13) above the view. Main had it 627 to 713px above.
- At 32px on an iPhone 13, Create draft's "household left the list" block is taller than
  the room: the button's top is kept and the failure ends 50px under the nav (D-213-1's
  limit).
- At 32px on an iPhone 13 in Safari, a long failure under Add to the registry, which sits
  in the body, not the bar, leaves that button under the sheet's header. The 178px
  duplicate refusal ends 16px above the bar, but the body scrolls 202px and the button's
  centre is under the header; a 226px failure leaves a sliver. D-225-3 scrolls only the
  alert because its action is pinned in the bar, which this one is not (verifier r1 nit
  1). The Pixel 5, the default text and the 130px offline failure are unaffected.
- At 32px on an iPhone 13, Add households' "household left the list" failure (274px)
  meets a bar grown to 128px by its note, 251px of room: its top 39px is under the
  header (verifier r1 nit 2).
- Record for a member's own form refusal opens Not saved, whose OK sends focus to the
  field it names at the top (D-119-15, D-221-10), which can leave the line beside Save
  out of view. As on the record form.
- On a revisit row the alert is above Mark done, so a second try clears it and Mark done
  moves up by its height, as on Team (D-213). Create draft's does not.
- Not measured: a real installed iPhone (the inset was simulated), the on-screen
  keyboard, VoiceOver and TalkBack.

## Follow-ups (owner)

- Move the five inline copies (amend sheet, Account, member page, member list,
  Sessions) onto `useFailureInView` (D-232-3).
- Add to the registry at 32px on an iPhone 13 (Known limits): D-213-1's alert, then
  button, would keep the button's top, if wanted.
- #225's test pinning the amend sheet's `[failure]` dependency stays open; the hook's
  own test pins it for the ten places using it.

## Relies on

D-37-6, D-117-46, D-119-15, D-119-21, D-136-3, D-164-2, D-164-7, D-195-1, D-208-4,
D-213-1, D-213-2, D-213-3, D-213-6, D-214-3, D-214-9, D-221-1, D-221-6, D-221-7, D-221-10,
D-221-15, D-225-1 to D-225-6, D-225-8, D-226-4, D-230-1, D-230-3.

## Open questions

None. D-232-4 and D-232-8 refine D-136-3 and D-213-3 within their reasons: the bar is
still measured as drawn, and nothing scrolls on open, on success or on a second try.
