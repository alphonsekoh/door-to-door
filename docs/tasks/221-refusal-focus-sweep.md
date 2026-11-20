# #221 · Give focus back after a failed press at the remaining busy-disabled buttons

- **Status:** Done (PR #229)
- **Phase:** 7 - Hardening
- **Depends on:** #214

## Task

#214 made giving focus back after a failed press on a busy-disabled button the app-wide
rule (D-214-2), through `useRefusalFocus`, at five places. This sweeps the rest of
#214's list onto the hook, as D-214-3 to D-214-5 set out, and records each place left
out. UI and tests only: no contract, schema or server change. Built in 098bc8f, 0d9ad8c
and 862ec8a.

## Decisions

- **D-221-1 · The rest of the app's busy-disabled presses use the hook.** Account's Save
  name; Add someone; a member's Sign out and Sign out everywhere; admin Teams' Remove,
  Delete team and team sheet; Create draft; a follow-up session's row Remove and Add
  households; Add blocks' Attach and Add to the registry; Mark done and Reopen in a note
  and on the revisit list; the follow-up sheet; the promote sheet; the Remove, Dismiss
  or Withdraw sheet; Undo on both Saved lines; Join, Leave and the team sheet; Record
  for a member; Export CSV; Show earlier visits. `undo-marked-button` draws only, so the
  hook is in its two callers. Each hook sits above its place's scroll (D-208-4). _Why:_
  D-214-2 (owner): the drop is the browser's, so the rule is app-wide.
- **D-221-2 · Out of scope where the failure takes the pressed button away.** Refresh on
  the session screen (a failure replaces the screen); Load more on own history, team
  records, admin follow-ups and the follow-ups screen (a failed page replaces the list
  with its failure and Try again); `ConfirmDialog`, as none of its ten callers keeps it
  open after a failure, and session detail's Remove the block replaces the whole screen.
  _Why:_ there is no button left to give focus back to. The verifier saw Refresh and
  Show more do this on both phones.
- **D-221-3 · Fake timers narrowed first (098bc8f, unsigned with the owner's leave).**
  `block-attach-sheet.test.tsx` and `outing-team.test.tsx` fake only `setTimeout` and
  `clearTimeout`, as D-214-10. _Why:_ a bare fake clock stops jsdom's frames and focus
  fixup for the rest of the file (R-214), and both files gain focus tests after it.
- **D-221-4 · A member's page gives focus back once its list is read again.** Every Sign
  out there stays disabled until the re-read, so `refused()` runs then, beside
  `setBusy(false)`. On Sign out everywhere the hook, not D-90-9, does the work: the
  confirm's return lands on a button still disabled. Keeps D-214-3; refines D-214-5's
  account of a confirm path. _Why:_ the same-tick rule; measured on both phones
  (verifier r1).
- **D-221-5 · `refused()` may follow the re-enabling update by one `await` on a settled
  promise, never by I/O.** Join and Leave, and admin Teams' Remove and Delete team, call
  it in the caller's `catch` after `await change()`, whose `finally` re-enabled the
  button a microtask earlier. Refines D-214-3's "in the same `catch` or its `finally`".
  _Why:_ both updates are made outside an event, so React draws them in one render
  (R-219); an `await` on I/O would split them. Join's test fails without its call.
- **D-221-6 · A button re-enabled in a transition is refused inside that transition.**
  The record form's Undo and Show earlier visits call `refused()` in the same
  `startTransition`. Refines D-214-3. _Why:_ called outside, it is drawn first, on a
  button still disabled, and the press is lost (R-219); both tests fail that way.
- **D-221-7 · A half-done add counts as a refusal.** In the follow-up and promote
  sheets, a door listed whose session step failed (D-117-46) gives focus to the retry,
  "Add to <session>", and a refused retry gives it to Done. _Why:_ the sheet stays open
  on that action, which is the member's next step.
- **D-221-8 · The follow-up sheet's action bar is one slot.** Add to list, the retry and
  Done are one element in one place, as the promote sheet's were; nothing else changes
  on screen. _Why:_ in two slots the retry was a new element, and the noted button had
  left the page.
- **D-221-9 · Only the newest Undo gives focus back, in both callers.** Only an Undo
  that got no answer keeps its button (D-117-71). _Why:_ an older Undo's late failure
  would spend the press noted for a newer one; one save's answer never acts on the next
  (D-117-72).
- **D-221-10 · A server `400` that opens Not saved gives focus back first** (follow-up
  sheet, Record for a member). The pop-up then opens from the pressed button. OK still
  sends focus to the field it names; for one the form does not show, such as a due date,
  D-90-9 now returns it to the button, not the page. D-119-15's rule is unchanged.
  _Why:_ as D-214-5 did for the record form.
- **D-221-11 · A follow-up session's row Remove is noted, though it is never disabled.**
  _Why:_ D-214-5 notes every press at the page's own control, never in its confirm; a
  refusal ends there through D-90-9.
- **D-221-12 · The tests poll for the drop, with `focusDropped()`
  (`test/focus-dropped.ts`).** It waits with `waitFor` until `<body>` has focus, where
  #214's tests wait one `nextFrame()`; those are unchanged. Refines D-208-6 and D-214-7.
  _Why:_ how soon focus drops varies (D-214-1, R-213). `waitFor` waits for state and
  retries nothing (D-192-1), and fails if the drop never comes.
- **D-221-13 · Each test presses the page's button by key, with `pressByKey()`
  (862ec8a).** It focuses the button, checks it has focus, then presses Enter, as the
  sign-in E2E does (D-214-6). A confirm's own button is still clicked. _Why:_
  `focusDropped()` also passes when focus was on the page from the start, where nothing
  was noted (reviewer r0); Enter presses only what has focus.
- **D-221-14 · Component tests only; four confirm-path tests do not test the hook.**
  Each place in scope has a D-208-6 test; no E2E is added. The tests for admin Teams'
  Remove and Delete team, the follow-up session's Remove and the Team card's Leave check
  only where focus ends, and pass without the hook, as D-90-9 gives focus back (D-214-7
  found the same for End and Deactivate). The device pass covers them. _Why:_ D-37-6,
  D-214-7.
- **D-221-15 · Create draft gives focus back once the list is read again (owner).** A
  `not_on_follow_up_list` refusal reads the list again and keeps Create draft disabled
  meanwhile, so the refusal now goes with that re-read: `refused()` runs inside the
  transition that draws the list, beside `setListed` (D-221-6), on every outcome (55a5a9e).
  Focus comes back when the list leaves the button enabled; when the read fails or leaves
  nothing ticked, the button stays disabled and focus stays on the page. The no-answer team
  controls and buttons disabled offline stay known limits. _Why:_ the owner, 2026-11-20:
  "Fix it in #229", and accept the other two; D-214-2, D-214-3.

## How existing decisions are handled

| Decision         | Effect                                                                                | By                |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------- |
| D-214-2          | Applied to the rest of the app; two places fall short (Known limits, owner)           | D-221-1, D-221-15 |
| D-214-3          | Refined: a settled `await` may sit between, and a transition's refusal goes inside it | D-221-5, D-221-6  |
| D-214-5          | Applied; on Sign out everywhere the hook, not D-90-9, gives focus back                | D-221-4, D-221-11 |
| D-214-7, D-208-6 | Refined: the tests poll for the drop and press by key                                 | D-221-12 to 14    |
| D-214-8          | Kept: success presses out of scope; the ones seen are listed below                    | —                 |
| D-214-10         | Applied to two more files                                                             | D-221-3           |
| D-119-15, D-90-9 | Unchanged: Not saved opens from the button, and D-90-9's return finds it              | D-221-4, D-221-10 |
| D-117-46         | Kept: the half-done add's retry and Done are where focus goes                         | D-221-7, D-221-8  |
| D-117-72         | Kept: an older Undo's answer spends nothing of a newer one                            | D-221-9           |

## Evidence

- Mutations on a scratch copy (reviewer): removing any one `refused()` fails a test at
  Save name, Add someone, both team sheets, Attach, Add to the registry, Mark done and
  Reopen, the follow-up sheet, the promote sheet, the Remove sheet, the revisit list,
  Export CSV, Create draft, Add households, Record for a member, Join and Admin Records'
  Undo. Moving `refused()` out of the transition (Show earlier visits, the record form's
  Undo), dropping the newest check in either Undo caller, refusing before the member
  page's re-read, or two slots again in the follow-up sheet each fails a test.
- Verifier r1 at 862ec8a, in an isolated copy: 30 of 30 mutations as expected. With the
  hook's `focus()` removed 31 tests in 18 files fail; only `admin-teams.test.tsx` passes
  (D-221-14). A dropped `notePress()` is caught, and a button never disabled fails
  inside `focusDropped()`.
- Verifier r1: E2E 185 passed, 7 skipped, on both phones. Device pass 64 of 66 a phone:
  focus back on the pressed button and inside all eight sheets, nothing scrolled, an
  iPhone tap untouched. The misses are layout already on main (Follow-ups).
- Reviewer r0's failing batch runs were the verifier's r0 mutations editing the shared
  worktree at the same time (builder r1). Reviewer r1 ran the 19 changed test files 3 of
  3 (664 tests) on a clean tree. Coverage: 283 files, 5087 tests, thresholds met.

## Known limits

- No answer on the Team card, admin Teams or either team sheet: every control stays
  disabled until a read succeeds, so focus stays on the page (seen on both phones). In a
  sheet, Tab goes back into the panel.
- Create draft refused `not_on_follow_up_list`: if the list cannot be read again, or
  leaves nothing ticked, the button stays disabled and focus stays on the page (D-221-15).
- A button also disabled offline stays disabled if the signal drops mid-request.
- As #214: after an iPhone tap focus stays where it was; VoiceOver and TalkBack were not
  measured.

## Follow-ups (owner)

- `admin-records.test.tsx:894` still calls a bare `vi.useFakeTimers()`. The two new Undo
  focus tests pass only because they run before it; a D-208-6 test added after it would
  hang (R-214). That file is #215's, with `active-session`, `session-detail` and
  `offline-shell`.
- Success presses (D-214-8), for a new issue. On screen or replaced after a slow
  success: Save name, Export CSV, Show earlier visits while more remain, Mark done and
  Reopen, Join (replaced by "You've joined"). Gone with their form: Add to the registry,
  Add to the team, Create draft.
- Already on main, seen by the verifier:
  - A sheet draws its failure at the top of its body and nothing brings it into view:
    Add to the registry, Record for a member and Add households at the default size, Add
    blocks and the follow-up sheet's half-done line at 32px. Worth one issue, as #213 did
    for Sessions and Team.
  - Its own failure line pushes a revisit row's Mark done 50px under the iOS install
    hint, and Create draft 11px under the Android install banner.

## Relies on

D-37-6, D-88-4, D-90-2, D-90-7, D-90-9, D-117-46, D-117-71, D-117-72, D-119-15, D-192-1,
D-208-3, D-208-4, D-208-6, D-208-7, D-214-1 to D-214-8, D-214-10.

## Open questions

- ~~**A refusal that meets a button still disabled for another reason: accept, or fix?**~~
  Settled by the owner on 2026-11-20: Create draft is fixed here (D-221-15); the no-answer
  team controls and buttons disabled offline are accepted as known limits.
