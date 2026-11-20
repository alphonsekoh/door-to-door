# #226 · A refused Start, End or Reopen shows the session's real state

- **Status:** Done (PR #231)
- **Phase:** 7 - Hardening
- **Depends on:** #213, #214

## Task

After End was refused because the session had ended elsewhere, Admin Sessions went on
showing "Running now" and End beside "This session has already ended, so it cannot be
ended." until a refresh. Start and Reopen, and a session's own page, did the same. #214's
verifier found it on both phones. Read the session again after the refusal, keep the
sentence in view (D-213-1) and keep #214's focus. UI only: all three operations already
document their `409`s, so no contract, schema or server change.

## Decisions

- **D-226-1 · A `409` from Start, End or Reopen is said, then the screen reads again.** The
  list reads the whole list; a session's page reads the session and its blocks. Every
  `409`, not only `conflict`: `session_already_active` can mean a session was started
  elsewhere. Not after a network failure or any other status. The sentence is not held
  back until the re-read lands. _Why:_ the pattern every other screen uses for a `409`
  (`admin-teams.tsx`, `outing-team.tsx`, `follow-up-item.tsx`; D-74-41, D-117-32). After a
  network failure the re-read would most likely fail too and swap the screen for its load
  error; holding the alert on a second request could hang it.
- **D-226-2 · One action slot per session, keyed by nothing that changes with its
  status.** `availableActions(status): ActionSpec[]` becomes
  `sessionAction(status): ActionSpec`, one a status, and both screens draw one
  `SessionActionButton` in place of a `.map` keyed by `spec.action`. When End turns into
  Reopen, React keeps the same `<button>`, so its failure and its focus (#214's refocus,
  or D-90-9's return from End's confirm) stay on it. A follow-up's Start blocker is decided from
  `sessionAction(status).action === "start"`, as from the map's `spec.action` before.
  _Why:_ keyed by action, the re-read unmounted End with its failure, and focus fell to
  the page. _Research:_ R-220.
- **D-226-3 · The server's sentence stays, unchanged, until the next press or a later
  change of action.** A `409` starts a wait that the screen's next read ends, changed or
  not. If that read turns the button into another action, the sentence stays under it; if
  it leaves the action as it was, the sentence stays where it is. Any later change of
  action drops it, as does any change after a failure that was not a `409`. Keeps D-194-2
  and D-28-3. _Why:_ the sentence names the state only that re-read shows ("has already
  ended" under Reopen). Kept through every change, a poll that read the session reopened
  left it under End (verifier r0). Kept until the next change, a clash read back
  unchanged, then started elsewhere, left "Another session is already active" under End
  (verifier r1).
- **D-226-4 · When that re-read turns the button into another action, the kept failure
  is brought into view again: the alert, then the button.** The scroll's deps are
  `[failure, spec.action]`. A re-read that leaves the action as it was, a success, a
  second try and any other change of action (which has dropped the failure, D-226-3)
  scroll nothing. The plan's accepted side effect, a 30 s poll bringing an old failure
  back into view, is gone. Refines D-213-3. _Why:_ the re-read redraws the row or page
  around the button; on a session's page the ended summary lands above it, and at 32px
  the alert was then up to 600px below the foot (verifier r2).
- **D-226-5 · On a session's page the `409` re-read is `load()`, not the poll's `tick`.**
  The Households and Teams panels keep their 30 s beat. _Why:_ reading the households
  again can set a follow-up Start's blocker and disable it under focus, dropping focus to
  the page just after #214 gave it back. Its cost is a known limit below.
- **D-226-6 · After a successful End by key, focus stays on the slot, now Reopen.** It
  follows from D-226-2 and does not extend D-214-8. _Why:_ the element is kept. Reopen
  never confirms (D-28-1), so a second Enter reopens at once, and End undoes it.
- **D-226-7 · One E2E: "reopening is two taps from the outing list" is extended and
  renamed** "an End refused because the session ended elsewhere shows it ended, and
  reopening is two taps from the list". It opens the list, ends the session through the
  `adminApi` fixture, presses End and its confirm with Enter, and checks "has already
  ended" only once the row reads Ended and End is gone. Reopen then has focus, one tap
  reopens, and the alert goes. No new spec. _Why:_ D-37-6; jsdom cannot show End's confirm
  giving focus back or the label changing on both engines. Checked before the re-read
  landed, a lost sentence passed about a third of the time (verifier r1); after it, 6 of 6
  runs failed.
- **D-226-8 · A change of action closes End's confirm, and drops what was said for the old
  action (aefc6e6).** Only D-226-3's re-read keeps the sentence. This is what the key on
  `spec.action` did. If End's request is still out when the change lands, the button reads
  "Working…" in Reopen's place. _Why:_ the confirm outlived the change: it hid while the
  button read Reopen and opened again, unasked, when a poll read End, right after the
  recovery reopen (verifier r0).
- **D-226-9 · Each screen counts its reads and passes the count as the button's required
  `read` prop (c03833f).** The count goes up in the same update as what was read: on the
  list in the same `startTransition` as the rows (D-171-1, D-171-2), on a session's page
  beside `setState`. The button keeps the last action and read it drew and compares them
  while rendering. _Why:_ a re-read that changed nothing leaves `spec` as it was, so the
  wait of D-226-3 never ended (verifier r1). Bumped outside the transition, the wait would
  end before the rows change (5 tests fail). _Research:_ R-220.
- **D-226-10 · Component tests on the button, the list and the page.** They cover: any
  `409`, End's confirm included, calls `onStale` once; a `TypeError`, `403` or `404` reads
  nothing; the in-place change keeps the alert, the element and its focus; an unchanged
  action, even with a new `spec` object, scrolls nothing; a later change drops the
  sentence and the confirm. #213's clash test now lets its re-read land ("Live outing"
  shows) and checks that nothing scrolls again, Start being still Start. The page's test
  checks the panels' `tick` is untouched. _Why:_ every mutation in Evidence fails one.

## How existing decisions are handled

| Decision                       | Effect                                                               | By            |
| ------------------------------ | -------------------------------------------------------------------- | ------------- |
| D-74-41, D-117-32              | Their `409` re-read applied to Start, End and Reopen                 | D-226-1       |
| D-28-3, D-194-2                | Kept: the server's sentence, unchanged                               | D-226-3       |
| D-213-1                        | Kept: alert, then button; run again when a re-read turns the button  | D-226-4       |
| D-213-3                        | Refined: a `409`'s re-read that turns the button scrolls again       | D-226-4       |
| D-208-4, D-213-4, D-214-2/3/5  | Kept: refocus before the scrolls; the kept element keeps the focus   | D-226-2       |
| D-90-9, D-111-14               | Kept: End's confirm gives focus back to the same element, now Reopen | D-226-2       |
| D-214-8, D-28-1                | Not extended; Reopen still never confirms                            | D-226-6       |
| D-171-1, D-171-2               | Kept: the list's read, with its count, is one transition             | D-226-9       |
| D-37-6                         | Applied: one test extended, no new spec                              | D-226-7       |
| #214's follow-up "Running now" | Closed                                                               | D-226-1 to -3 |

## Evidence

- Verifier r2 at c03833f, PASS: on both phones, at the default text and 32px, End, Start
  and Reopen refused on the list and the page end with the alert on the nav or banner,
  the page moving as far as the alert was hidden. In all 24 key-press cases focus ends on
  the same `<button>`, now the new action, with one settle and no jump back. An offline End
  says "Could not do that.", reads nothing and keeps focus. E2E: 185 passed, 7 skipped.
- Bites: the builder's 9 mutations and the verifier's 7 each fail at least one test
  (no end of the wait on a read, always or never dropping on a change, no re-scroll, no
  `onStale`, a wait on every failure, no or misplaced read count). With every failure
  dropped on a change, the E2E failed 6 of 6 runs.
- Builder: `test:coverage` 283 files, 5081 tests. One unrelated flake
  (`active-session.test.tsx`, unchanged from main) passed on the rerun.

## Known limits

- A re-read that fails (a signal drop just after the `409`, or a `5xx`) swaps the list or
  page for its load error. The sentence goes, and so does the button #214 just gave focus
  back to, so focus falls to the page. A successful press's re-read already does this on
  main. A re-read that kept the screen on failure was suggested (reviewer) and not taken.
- The button takes the screen's next read after a `409` for the one it set off. A read
  already out can land first: the page's 30 s poll, or another row's reload on the list.
  If it read the old state it ends the wait, and the sentence goes when the real re-read
  changes the action. The state shown ends right; only the why is lost (verifier r2 nit 1).
- Neither screen's `load()` is ordered: D-28-7's generation counter is not on them, as on
  main. A read sent before another admin's change that lands after the `409`'s re-read
  shows the old action until the next read. Not measured.
- Newer rows read in above the refused one, such as the clash's running session, move it
  down with no re-scroll (D-226-4 scrolls only when the button changes).
- A stale follow-up "nothing owed" refusal leaves Start enabled until the next poll
  (D-226-5), as on main.
- After a successful Reopen by key focus falls to the page (D-214-8, before this PR), and
  after an iPhone tap on End's confirm it ends on the page (#214's known limit).
- VoiceOver and TalkBack were not measured, so whether the kept button's new label is
  announced is unknown.

## Follow-ups (owner)

- D-28-7 says async lists guard against stale responses with a generation counter, but
  the Sessions list and a session's page never had one. #226 adds one read per `409`.

## Relies on

D-28-1, D-28-3, D-37-6, D-74-41, D-90-9, D-111-14, D-117-32, D-171-1, D-171-2, D-194-2,
D-208-4, D-213-1, D-213-3, D-213-4, D-214-2, D-214-3, D-214-5, D-214-8.

## Open questions

None. Each choice follows an existing decision or pattern. D-226-4 refines D-213-3 within
its reason: a second try, a success and a read that changes nothing still scroll nothing.
