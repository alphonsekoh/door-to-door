# #275 · Follow-up session: a thread of past visits on each picked unit

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #272, #160, #77, #117

## Task

In a follow-up session, a member opening a unit on the list sees what the team learned
there before: each earlier visit's interest level, description, member and team, and the
household's religion when known. Admins and members both read it, and the session's picked
units are kept on the phone so it opens offline. No new record type, no API change. Owner
rulings of 2026-11-23 and 2026-11-24 are on the issue; the answer to the plan's open
question (2026-11-24) is D-275-5.

## Decisions

- **D-275-1 · No contract or schema change.** The thread is the first page of
  `GET /households/{id}`; `currentUser()` still authorises it and any approved account
  reads any unit. _Why:_ the answer already holds name, contact, religion, visits with
  member and team, and notes; a new read would be a new thing to authorise (D-27-4,
  D-160-1).
- **D-275-2 · The thread is the history panel in thread mode.** Thread mode is on only at
  a unit on the running follow-up session's list, and the panel is never drawn twice.
  _Why:_ one view, reusing notes, suggestions and paging (D-160).
- **D-275-3 · Placement. Supersedes D-196-4 in part (owner ruling 2, 2026-11-23).** At a
  unit on the running follow-up session's list, the panel sits under the unit field, the
  notice and the list's chips, above Interest level. Every other unit, and every
  door-to-door session, keeps it last. _Why:_ the owner wants the thread first for a
  picked unit. D-196-18's "the panel stays last" now holds outside thread mode only.
- **D-275-4 · Order. Supersedes D-35-6 and D-160-8 in part, in thread mode only.** The
  timeline runs newest first, outstanding notes stay pinned above it, and "Show earlier
  visits" comes after the oldest entry, older pages added below it. 20 a page (D-160-14
  kept). _Why:_ the latest visit is what the next knock builds on. Elsewhere both stay
  oldest first.
- **D-275-5 · Late arrival is a known limit, thread kept on top (owner answer A,
  2026-11-24).** When the phone has no stored thread for the unit (a cold link, a copy
  past 12 hours, a tap before the preload reached it), the thread lands with the unit's
  own read and pushes Interest level and Add details down. The thread is not moved to the
  end of the form. Measured on 320x568 (verifier r0, normal path measured apart):
  - Cold, when the history lands: +522px at 16px, +579 at 17px, +2,318 at 32px.
  - Normal path before the fix, which moved at the session answer: +588 / +649 / +2,544.
  - Cold, while the list is unread, the panel is drawn at the end (151 to 200ms) and moves
    to the top when the list lands (4.2s with the list held 4s), on both engines. It
    stays at the end if the list fails. Consistent with D-272-14.
  - A reload with a stored thread still lands the thread only when the session answers:
    the remembered session kind is in memory, so `assumeCopyOuting` (D-275-15) does not
    apply after a reload. (A) says "a link or reload", but there the phone does hold one.
    _Why:_ the normal path has the thread on the first frame; (B) would put the same unit's
    thread in two places.
- **D-275-6 · Normal path: the thread arrives with the session answer. Extends D-200-3.**
  The thread is not drawn before the block screen's own `/sessions/active` answer, because
  `followUpSession`, and so `outingId` and `followUp`, are null until it lands. It
  therefore arrives with the session notice and the chips, the movement D-200-3 accepted.
  If the unit's read beats that answer, the panel first draws at the end, then moves to
  the top. Verifier r2, with the copy already holding the list: the thread was on the
  first frame in 8 of 8 runs, +0. _Why:_ nothing above the unit field may arrive late
  (D-181-7, D-200-1), and this is below it.
- **D-275-7 · Known limits, accepted with the above.**
  - A teammate's visit recorded after the preload: the stored thread opens without it and
    the unit's read adds it above the picker (Medium +618px at 32px).
  - At 32px on a cold open, a Save made while the thread lands left the next unit's field
    16px under the docked Save in 2 of 10 replays on Pixel 5.
  - 32px: "Read less" leaves its toggle 528px above the screen; the clamp is 14 lines; for a
    unit with 20 visits Medium is 12.4 screens down.
  - The age line is not shown online while a read hangs.
  - In the offline shell an admin's own note reads "Added by Admin User" (no user for
    `useRole()`); the shell's unit field sits 50px under Save at 320x568 and 32px, with or
    without a thread (not caused here).
  - A real iPhone still owes: Continue offline and open a listed unit (age line wrap at
    the largest text), save offline and reopen ("Not sent yet" at the top), and the first
    household tapped in a session.
    _Research:_ R-259.
- **D-275-8 · An entry shows interest chip, date, member, team and description.** The team
  only where it was stamped on the visit (D-74). A description over 3 lines or 160
  characters is cut at a word boundary with "Read more" / "Read less" (`aria-expanded`),
  logic in `src/lib/households/clamp.ts`. _Why:_ owner ruling 1; the clamp keeps the picker
  near and is testable in jsdom.
- **D-275-9 · Religion is shown only in the thread, once at its head, and only when
  known.** Never recorded or erased: no label, no empty row. _Why:_ owner rulings 1 and 6
  and the 2026-11-24 clarification; it does not depend on how erasure is stored.
- **D-275-10 · `LocalCopy` is `v: 3` and adds `threads`.** v1 and v2 copies read as v3 with
  none. Each thread is `{ history, savedAt }` and expires 12 hours after its own read
  (exactly 12 h is kept), dropped on load and on write. Sign-in and sign-out clear the
  whole copy as before (D-77-6). Extends D-77-3 (owner ruling 5), D-129-8; refines D-117-17
  and D-77-5. _Why:_ reading the list again must not keep a stale thread alive; the policy
  row for the phone (#276) stays true.
- **D-275-11 · Threads are kept only for households on the copy's list.** They are dropped
  when the list drops the household, or the outing or the member changes. While the screen's
  list is unread or failed, threads show, and reads are kept, only for units on the copy's
  list; with no list known none show or are kept. _Why:_ a unit off the list must not open
  as a thread before the list says so. This replaces the builder's first rule (any read
  kept). A screen told another session starts its threads over, so nothing of the ended
  session is shown or handed on, and its preload batch stops. Each screen's list is tied
  to the session it was read for: the Session screen's list is keyed by session, and the
  block screen passes its list only for the session it was read for, so after a switch
  the Session screen shows "Loading the list…" rather than the ended session's. A unit whose thread
  the copy did not take (it had no list for that session yet) is read again at the next
  list read. _Why:_ after a switch the copy otherwise kept too few of the new session's
  threads, and a quick tap could draw the old session's thread for a frame (verifier r3).
- **D-275-12 · No new server read; the preload reuses `GET /households/{id}`.** It runs
  whenever the running follow-up session's list is read with signal (Session or block
  screen), 3 at a time, one run at a time, failing silently (a thread not read is read by
  the form when opened). A thread is read again when missing, when its newest visit or the
  household differs from the list's entry, or after 15 minutes. _Why:_ near zero extra
  reads in steady use; sin1 and Neon share a region (#252).
- **D-275-13 · Background reads use plain `fetch` with the send timeout (`readThread`),
  not `apiFetch`.** _Why:_ as the list read (D-117-17, D-85-1): a background refusal must
  not raise the account message.
- **D-275-14 · Threads pass to the next screen in memory only** (`remembered`, keyed by
  member). It carries the running session's newest list with its threads: the screen's
  own list once read, else the last one it handed on for the same member and session. So
  the first tap of a new session has its thread on the first frame, though the copy held
  no list for it when the Session screen opened: 144 of 144 taps (verifier r3; both
  engines, default and 32px text, member and admin, from an empty phone, an earlier
  session's copy, or the app opened before the session began), where it was late 6 of 6
  on iPhone before. _Why:_ reading the copy from IndexedDB lands a frame after first paint;
  a reload reads the copy as before.
- **D-275-15 · `assumeCopyOuting`.** When the remembered session kind is `follow_up` and
  this screen's own session read has not answered, the copy's outing is taken as the one
  running, so stored threads show on the first paint. The answer replaces it. _Why:_ the
  normal path (D-275-6).
- **D-275-16 · In thread mode, owed notes say "Saving your visit marks this done".** No
  Mark done and no locked line, even when `active` is unknown. Refines D-117-25 and
  D-117-74, as reworded by D-272-22. _Why:_ at a listed unit in a follow-up session the
  save is what marks it done.
- **D-275-17 · The form no longer checks `followUp` before using `threads`.** D-196-4 in a
  door-to-door session now rests on the hook, which gets `outingId` null. _Why:_ one place
  decides.
- **D-275-18 · Admins get the preload too.** D-74-13 is unchanged: the preload does not
  join a session. _Why:_ admins record (D-272-2) and the copy is already written for them
  (D-77-4); joining happens on the first record, too late for the first door.
- **D-275-19 · This phone's own records show at the top of the thread.** "You", with "Not
  sent yet" until sent; kept once by visit id. The stored thread's age line ("As last read
  with signal, ...") shows only when the thread shown is the stored one and the read
  failed or the page is the offline shell. Refines D-160-12, for the thread only. _Why:_
  "appears without a reload", offline too; online a line that came and went would move the
  picker.
- **D-275-20 · Kept: D-74-13, D-117-48, D-272-21, D-27-4.** #278 is untouched; the shell
  still offers only the list's blocks, where every thread lives. _Why:_ changing it needs
  the owner to supersede both. The one-phrase change to #276's privacy policy ("the
  session's units, with their earlier visits, for 12 hours or until sign-out") is made on
  #276, not on this branch.

## Relies on

D-27-4, D-35-6, D-74-13, D-77-3, D-77-5, D-77-6, D-117-17, D-117-48, D-129-8, D-160-1,
D-160-8, D-160-12, D-181-7, D-196-4, D-196-18, D-200-1, D-200-3, D-272-14, D-272-21.

## Open questions

None. Conflicts with D-196-4, D-35-6 and D-160-8 are superseded in part by the owner's
rulings on #275.
