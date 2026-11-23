# #272 · Follow-up session: anyone records at any unit in its blocks

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #117, #251, #74

## Task

In production a member saw "Not saved. This unit is not on this session's list." in a
follow-up session; only an admin could record. The owner wants everyone taking part to
save. "Save a note" means recording a visit; follow-up note rights (D-117-12) do not
change. Owner rulings of 2026-11-23: Q1 = A (a visit off the list is a one-off), Q2 = A
(any approved member while the session is active).

## Decisions

- **D-272-1 · No regression.** The refused doors were off the list (owner, 2026-11-22).
  Listed units save through `POST /visits` and sync (83 integration tests and the E2E pass
  on `dev`). _Why:_ the issue asked for a bug to be ruled out first.
- **D-272-2 · In a follow-up session, anyone records at any unit in the session's
  blocks.** The session and block checks stay (an unattached block is `409 conflict`, no
  active session `409 session_not_active`). Recording adds the member to the session
  (D-74-13). Supersedes D-117-15 and D-117-18; supersedes D-117-16 in part: nothing new is
  held, and a record a phone already holds as `not_on_follow_up_list` lands on its next
  probe, unchanged (D-33-2). Rewrites the follow-up-session invariant in CLAUDE.md.
  _Why:_ the owner wants participants to save at new doors; admins always could, and any
  member can join an active session with one tap, so a join step would keep no one out.
- **D-272-3 · A visit off the list is a one-off.** It marks nothing, picks nothing and
  leaves the list as it is. It reaches the list only through Suggest, then an admin lists
  it and adds it to the session (D-117-46). Keeps D-117-65 and D-117-38. _Why:_ a pick
  needs a listed note, and members cannot list one (D-117-3).
- **D-272-4 · One list rule, three uses: the revisits list, the marking and a member's
  note changes.** The recording-only helpers (`listBinds`, `assertMayRecordHere`,
  `unitsOffRevisitList`, `isUnitOnRevisitList`, `offRevisitList`) are deleted.
  `onRevisitList` is kept. Refines D-117-40, whose agreement test now compares those
  three. _Why:_ the rest would be unreachable code.
- **D-272-5 · The session lock stays; under it only the session and the block are
  judged.** Refines D-117-45 and D-251-3. _Why:_ the lock still orders a record against a
  pick change, for the marking, D-117-42's visited check and `block_in_use`.
- **D-272-6 · The queue is unchanged.** `classify.ts` still holds and probes
  `not_on_follow_up_list` every 5 min, and `sync-ui.ts` keeps its wording, for records
  held before the deploy. Refines D-117-16 (the note at D-33-16 reads the same way).
  _Why:_ phones hold them today, and nothing unsent is dropped (D-33-2).
- **D-272-7 · The form treats every caller as it treated admins.** One caption for an
  off-list unit, "Not on this session's list. You can still record it.", no refusal, no
  wait for the list and no re-read. The "Nothing in this block is on this session's list"
  notice goes. Supersedes D-117-58. _Why:_ never warn of a refusal the server does not
  make.
- **D-272-8 · After a member's save at a door off the session's list, the Saved line
  offers "Suggest a return visit".** Never at a listed door, where Undo or Reopen is the
  way (D-117-74). Refines D-117-26. _Why:_ it is the new door's only way onto the list.
- **D-272-9 · Every member, not only admins, sees "Blocks in this session"**, with a new
  banner and hint. Refines D-117-24. _Why:_ the reason admins had them now applies to
  members, and a block whose picks all left the list could not be reached otherwise.
- **D-272-10 · A block outside the session reads the same for both kinds.** "Visits can
  be recorded only in the session's blocks. Pick one on the Session screen." Refines
  D-117-47 and D-117-26: the off-list notice, its "ask an admin" text and the "Not saved.
  This unit is not on this session's list." refusal are gone. _Why:_ the follow-up wording
  named a rule that no longer exists.
- **D-272-11 · The contract changes in text only; the `ErrorCode` list is unchanged.**
  _Why:_ `not_on_follow_up_list` is still sent for a member's note change off the list
  (D-117-12) and for picks.
- **D-272-12 · `SyncCaller` is `{ id }`, and `Write.caller` and `judgeList` are gone.**
  _Why:_ nothing reads the role any more.
- **D-272-13 · The block screen's `outside` is a boolean**, not a kind-specific state.
  _Why:_ D-272-10 leaves one outcome.
- **D-272-14 · Suggest is offered only once the list was read and the unit is not on
  it** (`Saved.onSessionList`, worked out at save time). Never while the list is unread.
  Refines D-272-8. _Why:_ an unread list cannot say the door is off it, and a wrong offer
  at a listed door would contradict D-117-74.
- **D-272-15 · The agreement test checks the marking through `done_visit_id`.** Refines
  D-117-40. _Why:_ with recording no longer judged, marking is the third use of the rule
  and `done_visit_id` is what records it.
- **D-272-16 · The E2E records at a new off-list unit on each run.** _Why:_ the database
  persists between runs, and a unit with history would change what the test sees.
- **D-272-17 · No retro-marking.** A one-off whose household is later listed and picked
  is not marked by its replay; the answer is `unchanged`. Refines D-117-73. _Why:_ a
  visit marks only what was on the list when it was written (D-117-65), and a replay is
  idempotent (D-21-1).
- **D-272-18 · The follow-up E2E "waits on the phone…" test is deleted.** The server no
  longer holds such a record; unit tests cover the sync wording. _Why:_ D-37-6, a thin
  suite.
- **D-272-19 · The follow-up Saved line holds its height from Sending to Suggest**
  (`min-h-offer-back`, commit 5dbdf0e). Refines D-117-59 and D-117-71. _Why:_ an off-list
  save now shows an offer row and Back to the list, and the line must not grow under the
  pinned count. _Research:_ R-85.
- **D-272-20 · A member's off-list one-off now pins its block (D-117-42).** Removing the
  last pick in that block is `409 block_in_use` (D-18-3), where before only an admin's own
  off-list visit could cause that. Accepted. _Why:_ a block with a visit in the running
  session cannot leave it, and members can now make one.
- **D-272-21 · D-117-48 is kept.** Offline, only the list's blocks are offered, so a
  session block with nothing on the list cannot be reached in the offline shell. _Why:_
  the copy's list alone makes it usable, so the shell offers the list's blocks only.
- **D-272-22 · "An admin off the list" now reads "anyone off the list".** Refines
  D-117-65 (a visit off the list marks nothing) and D-117-74 (no Mark done on a note the
  save will mark). _Why:_ the caller's role no longer matters to recording.

## Relies on

D-117-12 (note rights), D-117-37 and D-117-38 (picks), D-117-42, D-117-45, D-74-13, D-33-2,
D-21-1.

## Open questions

None. The owner ruled on both (2026-11-23).
