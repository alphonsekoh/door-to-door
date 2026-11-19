# #213 · A failed action on Admin Sessions or Team is said in view

- **Status:** In progress (branch `fix/213-admin-failure-in-view`)
- **Phase:** 7 - Hardening
- **Depends on:** #164, #194, #195

## Task

A failed Start, End or Reopen on the Sessions list could end under the nav, and a failed
role change on Team was said once above the list, off the screen. Both were already on
`main`; #194 (PR #210) changed only their wording and left them as a known limit. Bring
each failure into view beside its control, as the member page does. UI only: #210's
wording is kept, and focus after a failed press is left to #214.

## Decisions

- **D-213-1 · Sessions: the alert, then the button, are each brought into view.** On the
  Sessions list and a session's own page, a failed Start, End or Reopen runs two
  `scrollIntoView({ block: "nearest" })` calls in a layout effect, first on the alert,
  then on the button. Both are `scroll-clear-nav`. The alert stays under the button, and
  both screens keep main's layout. Where the two cannot both fit, the button's top is
  kept. This refines D-164-1 and D-195-1's single block for a control beside its row's
  title; it is the field-then-label two-step of `bringIntoView` in `use-modal.ts`.
  _Why:_ a block that also held the title (b37cf33) was 608 to 774px tall at 32px,
  against 607px of room on a Pixel 5 and 544px on an iPhone 13. `nearest` lined up its
  top and left the alert's end 61 to 460px under the nav (verifier r0). The issue asked
  for the single block exactly (Open questions). _Research:_ R-212.
- **D-213-2 · Team: a failure is said in that row, just above its controls.** `failure`
  is `{ at, message }`, as in `member-detail.tsx`. A failed role change or deactivation
  is said in one `scroll-clear-nav` block with that row's controls, scrolled into view
  with `nearest` in a layout effect. The line above the list is gone. The next change
  clears it, and a later failure moves to its own row. Applies D-125-22 and D-195-1
  exactly. _Why:_ said above the list, it sat 183 to 269px above the screen for a lower
  row (issue).
- **D-213-3 · Only a failure appearing scrolls.** Nothing scrolls on load, on success, or
  when a second try clears the alert; a second failure scrolls again. Applies D-164-2.
  _Why:_ on a second try the control is under the thumb that just pressed it.
- **D-213-4 · Focus is not moved; the tests check only that the alert takes none.** Where
  focus lands after a failed press on a busy-disabled button is #214's. _Why:_ b37cf33's
  checks that focus stayed on the pressed button held only because the mock failed within
  one jsdom frame, and #214 measured real browsers dropping it to the page (reviewer r0,
  verifier r0). A refocus that #214 adds here goes before these scrolls, with
  `preventScroll` (D-208-4).
- **D-213-5 · The Sessions E2E sets Start on the foot of the screen and bounds the move
  from both sides.** The existing clash test in `e2e/session-lifecycle.spec.ts` adds four
  newer drafts, sets Start on the nav or a floating banner, and presses it into a clash
  at the default text and at 32px. As in D-164-9 and D-195-6: Start's top is on screen,
  the alert ends at most 0.5px past the foot, the page moves at most 1px more than the
  alert was hidden, and the alert has no focus. `footTop` moved into `e2e/fixtures.ts`.
  _Why:_ jsdom lays nothing out. It fails on b37cf33 at 32px (the alert ends at 768,
  against 663.5 and 600.5) and on main at the default text (779 against 663.5, 635
  against 519.5). It extends a test rather than adding a spec, to keep the suite thin.
- **D-213-6 · Team has no E2E.** Its scroll is proved by jsdom and the verifiers' device
  passes: both phones, the default text and 32px, role change and Deactivate, a lower
  row. _Why:_ keep the suite thin; D-195 left Sign out everywhere to jsdom the same way.

### How existing decisions are handled

| Decision          | Effect                                                            | By          |
| ----------------- | ----------------------------------------------------------------- | ----------- |
| D-164-1, D-195-1  | Applied to Sessions with two scrolls in place of one block (open) | D-213-1     |
| D-125-22, D-195-1 | Applied to Team exactly, as `member-detail.tsx` does              | D-213-2     |
| D-164-7           | `scroll-clear-nav` reused on both screens                         | D-213-1, -2 |
| D-164-2           | Applied to both screens                                           | D-213-3     |
| D-208-4           | Kept: #214's refocus goes before these scrolls                    | D-213-4     |
| D-164-9, D-195-6  | Their two-sided bound reused in the Sessions E2E                  | D-213-5     |
| D-194-2, D-194-4  | Wording kept; #194's known limit on these two screens fixed       | D-213-1, -2 |

## Evidence

- With both scrolls, or only the alert's, removed, 5 component tests fail; with their
  order swapped, 3. On Team, with the scroll removed, with the failure in every row, or
  with `scroll-clear-chrome`, all 3 new tests fail (verifier r1).
- On both phones at the default text and at 32px, refused and offline Start, End and
  Reopen (24 cases) and offline role change and Deactivate (8 cases) end on the nav or the
  floating banner, and the page moves exactly as far as each was hidden (verifier r1).

## Known limits

- At 32px the follow-up "nothing owed" refusal is about 610px on its own, more than the
  room on either phone. Start is kept at the top margin and the message's end stays
  below the nav (builder r1).
- On Team the alert is above the controls, so a second try clears it and the row's
  buttons move up under the thumb by its height, as D-164's limit on Account. On Sessions
  the alert is below the button, so nothing moves.
- Each Sessions row keeps its own failure, so an older row's alert stays after another
  row fails. Already so on main.
- On Team, a refused change on the admin's own row, pressed before their sign-in has
  loaded, can go unsaid: once it loads the row shows its "You cannot change your own
  role" note in place of the controls and the alert (reviewer r1).
- The clash E2E finds a session running only because an earlier test in the file left
  one; run alone it fails. Already so on main (verifier r1).
- After a failed Start or Reopen focus is on the page on both phones, and after End's
  confirm Chromium returns it to End but WebKit does not (verifier r1). For #214.

## Relies on

D-90-9, D-111-5, D-111-24, D-111-46, D-125-22, D-164-1, D-164-2, D-164-7, D-164-8,
D-164-9, D-194-2, D-194-4, D-195-1, D-195-6, D-208-4.

## Open questions

- **Sessions: two scrolls, not the single block the issue asked for (D-213-1).** They
  land where a block of just the alert and the button would, and keep main's layout. A
  real block of the two would put the alert beside the title instead of on a full row
  under both. Accept D-213-1, or ask for the block?
