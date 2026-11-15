# #155 · A unit typed as the block screen's answers land

- **Status:** Done (PR #172), with #156
- **Phase:** 7 - Hardening
- **Depends on:** #113

## Task

On WebKit, `e2e/follow-up-session.spec.ts:56` (now `:111`) sometimes lost a fill: the
unit field went back to the linked `#05-123` (2 of 40 at e0ea12f). #113 left the cause
unfound (D-113-10). Find what writes the old unit back and fix it in the app, with no
waits.
Built on one branch with #156, on the same screen: 33ed33a (the block screen and the
history), d813b0a (the queue, Undo, Mark done) and efea5f9 (`useRole`).

## Decisions

- **D-155-1 · The cause: an answer set inside the unit field's `input` event was
  urgent.** WebKit can run a fetch's continuation inside that event, after the field has
  changed and before React has read it. React took the update's priority from
  `window.event`, so it was drawn at once with the unit still in state: the old unit was
  written back, React's value tracker with it, and `onChange` never fired. _Why:_ found
  by recording only the `value` setter's writes, as the issue asked. _Research:_ R-151.
- **D-155-2 · Answers that can land while a unit is typed are set in
  `startTransition`.** The block screen's units, session, revisit list and team; the
  form's unit history; Undo's answer; the reload after Mark done or Reopen; and
  `SyncProvider`'s `setLive`. _Why:_ a transition is drawn after the event, so the typed
  unit is read first. _Rejected:_ an uncontrolled field (D-113-1 kept it controlled);
  reading the field in `onInputCapture`, which guards one field and keeps the urgent
  redraw; waits in the spec. _Extended by D-171-2:_ New session's follow-up list and
  the sessions list. _Extended by D-160-9 (#160):_ the history panel's older pages,
  although their land-while-typing test cannot fail.
- **D-155-3 · The session kind is told to `knownSessionKind` from an effect, once this
  screen has drawn it.** _Why:_ a store's change is drawn at once whatever the lane
  (R-151), so telling it as the answer lands could put the unit back. _Trade-off:_
  leaving the screen before it has drawn the kind passes nothing on, and the next screen
  says "Save" until its own answer (D-117-19).
- **D-155-4 · The guards are jsdom tests through `test/land-while-typing.ts`.** The
  helper sets the field, makes `window.event` that `input` event, releases the answer
  under React's own scheduling rather than `act`'s, then dispatches the event. Eight
  tests use it, covering every update in D-155-2 and D-155-7. _Why:_ `:56` cannot tell
  fixed from broken (Evidence). The in-engine probe was left out of `e2e/`: the owner
  moved it to its own issue, #176 (2026-11-12). _Extended by D-171-5:_ two more, for
  New session, so ten in all. _Extended by D-176-1:_ #176 put the probe in that test,
  now `follow-up-session.spec.ts:111`, on both engines.
- **D-155-5 · The follow-up and promote sheets' answers stay urgent.** _Why:_ they land
  while their sheet is open, and the page behind an open sheet is inert (D-90-7), so the
  unit field cannot be taking text. The other paths left urgent are under Known limits.
- **D-155-6 · Whether a real keystroke or paste ever met this is unverified.** What lost
  the unit was Playwright's `fill`, which inserts text with no `keydown` or `paste`. A
  key fires `keydown` and a paste fires `paste` before the field changes, and React
  listens to both, so an answer ready by then probably lands there, harmlessly. Neither
  was tried on a device. _Why:_ an earlier draft held a paste at risk, but `paste`
  stands where `keydown` does (reviewer). The fix does not depend on it.
- **D-155-7 · `useRole` subscribes to the role it derives, not to the account store's
  snapshot.** A `/users/me` that agrees with the token draws nothing; a role change still
  does. Keeps D-85-8. _Why:_ every answer replaces the snapshot, and a store's change is
  drawn at once (R-151), so one landing in the field's `input` event put the unit back.
  `AccountGate` still reads the whole snapshot, but its children do not render again.
  `deriveRoleState` is now used only by tests.

## Evidence

- **In-engine probe** (verifier round 1, `probe155.mjs`; in the repo since #176,
  D-176-1). The screen is reached by client navigation. Its first `/api/sessions/active`
  and `/api/households` answers are held in the page and released from a window capture
  `input` listener during `fill("#09-999")`. At the branch head the unit was kept 10 of
  10 on both engines. In a production build with every transition undone it was kept 0
  of 10: the field went back to `#05-123`, its chip pressed. Round 0 showed the same for
  the revisit list and the team alone, and round 2 for `/users/me` with the old
  `useRole`.
- **jsdom.** Each guarded update was made urgent again in turn, and its D-155-4 test
  failed (verifier rounds 1 and 2).
- **Not evidence:** `:56` passed 40 of 40 on WebKit and 20 of 20 on Chromium at the
  head. It also passed 40 of 40 on WebKit with every transition undone, since the flake
  was a 2-in-40 race. The issue's 40/40 criterion is met, but it does not show the cause
  is fixed.

## Known limits

- Still urgent: `save()`'s own continuations (a follow-up re-check's refusal, a failed
  direct save) and `SyncProvider`'s `setConfirmed(undefined)` when the sign-in check
  names someone else. A keystroke landing with one can still be lost. A save that
  succeeds replaces the unit by design (D-25-5). The owner accepted these as limits
  (2026-11-12): each follows the member's own Save or a change of account.
- With `setLive` a transition, a queued save's line can say "Saved … on this phone."
  briefly before it says "Sending" (reviewer, round 1). Its rows are held (D-117-59,
  D-117-71), so nothing moves.
- A send finishing as a member types or pastes on iOS is covered by jsdom and an in-page
  offline run only, not on a device.

### How existing decisions are handled

| Decision | Effect                                                                  | By               |
| -------- | ----------------------------------------------------------------------- | ---------------- |
| D-113-10 | Resolved: the cause is found and fixed in the app                       | D-155-1, D-155-2 |
| D-113-1  | Kept: the unit field stays controlled                                   | D-155-2          |
| D-113-7  | Kept: the session still reaches the app as a transition; now answers do | D-155-2          |
| D-117-19 | Kept: the kind is still told to the next screen, once drawn here        | D-155-3          |
| D-85-8   | Kept: the latest `/users/me` still wins for the same account            | D-155-7          |
| D-37-6   | Kept here: the probe spec is #176 (owner); done there (D-176-1)         | D-155-4          |

## Relies on

D-25-5, D-37-6, D-85-8, D-90-7, D-113-1, D-113-7, D-117-19, D-117-59, D-117-71.

## Open questions

None. The owner ruled on 2026-11-12: the paths under Known limits' first item stay
urgent, as recorded limits, and the deterministic probe becomes an E2E spec in #176.
#176 added it to the follow-up spec (D-176-1).
