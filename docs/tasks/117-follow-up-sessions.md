# #117 · Follow-up sessions and a reviewed follow-up list

- **Status:** In review (PR #117)
- **Phase:** none (no milestone)
- **Depends on:** #17, #20, #21, #22, #30, #33, #35, #74, #77, #111

## Task

An owner request with no issue. A session is now door-to-door or follow-up; in a
follow-up session the team goes back only to households an admin has put on the
follow-up list. Members suggest return visits for an admin to review, every removal is
soft, and the UI explains each rule to people using it for the first time.

The owner's request (only admins add to the list; members edit list entries only in a
follow-up session) and answers A to F from two planning rounds were relayed by the
workflow on 2026-10-24 and are in the PR #117 body. Decisions marked **(owner)** come
from them.

## Decisions

- **D-117-1 · No issue, so the PR's number names the task.** This file, `D-117-n` and
  `Refs #117`. _Why:_ GitHub numbers issues and PRs from one sequence, so no later issue
  can take 117; an invented number could.

### Data and contract

- **D-117-2 · `outing_sessions.kind`: `regular` | `follow_up`, default `regular`,
  optional on create, fixed at creation.** No endpoint changes it. Still one active
  session app-wide whatever its kind (D-07-4). _Why:_ switching mid-session would change
  who may record where under members already out; the default keeps old rows and
  clients working.
- **D-117-3 · `follow_ups.status`: `suggested` | `listed`, default `listed` (owner, A).**
  Every existing note backfills onto the list. The caller's role sets it on create: admin
  `listed`, member `suggested`. `listed_at`/`listed_by` name the admin who listed it and
  are null for backfilled notes, whose byline reads "Added by" as before. _Why:_ notes
  members already wrote stay on the list and readable.
- **D-117-4 · Every removal is soft (owner, E).** `deleted_at`, `deleted_by`,
  `delete_reason`, set by `DELETE /follow-ups/{id}?reason=` (at most 500, trimmed, blank
  stored as null). A removed note leaves every list, count, duplicate check and the
  recording rule, is `404` to PATCH and DELETE, and cannot be restored; an admin adds the
  household again. _Why:_ the author must be told a suggestion was declined, and why.
  The reason is a query parameter because no DELETE in the contract has a body.
- **D-117-5 · Removed notes are read only through `GET /follow-ups?deleted=true`**,
  newest removal first: admins, or a member whose `authorId` is themself; anyone else
  `403`. Every other read leaves them out. Extends D-22-1. _Why:_ an admin's audit trail;
  a member learns only about their own notes.
- **D-117-6 · `FollowUp` gains `blockId`, `status`, `listedAt`, `listedBy`, `deletedAt`,
  `deletedBy`, `deleteReason`.** Extends D-35-2. Only listed notes are owed: a
  household's `outstandingFollowUps`, the overdue card and "Overdue" count them alone,
  and a suggestion's date reads "Go back by". _Why:_ a client can tell which notes a
  session's blocks cover without a lookup; a suggestion's date is a wish until listed.

### Creating, promoting and removing notes

- **D-117-7 · A member's note is a suggestion, allowed with or without a session (owner,
  C).** It is `409 follow_up_exists` if the household has an unresolved listed note or
  any pending suggestion. A resolved or removed note never blocks one. A partial unique
  index (`status = 'suggested' and deleted_at is null`) holds one pending suggestion per
  household, so of two members at once one gets `201`, the other `409`. _Why:_ it would
  repeat what is owed or waiting; the database decides the race, as D-17-2. _Research:_
  R-7.
- **D-117-8 · An admin's note is listed, and a household may carry several, but it is
  `409 follow_up_exists` while a suggestion waits.** The admin lists that suggestion
  instead; the UI's "Add to follow-up list" does so there. _Why:_ a listed note beside
  it would leave the suggestion waiting on a listed door, and dismissing it would tell
  its author it was declined when it was not.
- **D-117-9 · Every write that opens or changes a note locks the household row, then
  the note, and judges rights on what it reads under the lock.** Always in that order.
  _Why:_ without it, an admin listing while a member suggests leaves a listed note with
  a suggestion beside it, and an author withdrawing while an admin lists removes a
  listed note; one order means the two never deadlock. _Research:_ R-35.
- **D-117-10 · Only an admin promotes (`PATCH status: listed`).** Sending it twice
  changes nothing; the first lister and `listedAt` stand. There is no way back to
  `suggested`. _Why:_ owner, C; a stale screen must not take the credit (as D-35-8).
- **D-117-11 · A suggestion has no done state.** `done` on it is `409 conflict`, unless
  an admin promotes it in the same body. _Why:_ nothing is owed until it is listed.
- **D-117-12 · Who may change a note (owner, request item 2, C and E).** Admins: anything,
  any time. A suggestion: its author may reword, re-date or withdraw it at any time;
  anyone else `403`. A listed note: a member may resolve or reopen it only while it is on
  the running follow-up session's list (D-117-14), otherwise
  `409 not_on_follow_up_list`; rewording or re-dating also needs the author (`403`), and
  removing it is admin-only (`403`, the author included). Refusals in the order `404`,
  `403`, `409`. Supersedes D-35-1 and D-22-2's edit clause. _Why:_ only an admin decides
  what is owed, and members edit list entries only in a follow-up session.

### The list and recording

- **D-117-13 · `GET /sessions/{id}/revisits` returns a follow-up session's list.**
  Members read the active session's only (`403` otherwise); admins any status, so a
  draft's list can be checked before starting it. A regular session is `409 conflict`.
  Not paginated, and fixed in query count (D-20-3). _Why:_ an admin builds the list by
  hand, so it stays short.
- **D-117-14 · One list rule, `onRevisitList` (`src/server/follow-ups/list-rule.ts`).**
  Listed, not removed, in one of the session's attached blocks, and outstanding or
  resolved since the session started; a draft counts outstanding only. It decides the
  revisits list, the recording refusal and D-117-12's session check. _Why:_ the list and
  its refusals cannot disagree (an integration test compares them case by case); a door
  marked done tonight stays on tonight's list, and one done last month is not tonight's
  work.
- **D-117-15 · In a follow-up session a member records only at listed households (owner,
  B and F).** Any other new visit is `409 not_on_follow_up_list` on `POST /visits`, and
  a sync item is `rejected` with the same code. The caller's role decides, so an admin is
  exempt, also recording on a member's behalf. Amending a stored visit, by PATCH or sync,
  is never judged. In sync the check follows the session, clock and block checks, so an
  ended session still answers `session_not_active`. Regular sessions are unchanged.
  _Why:_ an amend corrects what was allowed when it was recorded (D-20-2, D-74-32). The
  rule is about who chooses the door; D-74-33 still governs amends.
- **D-117-16 · The queue holds a `not_on_follow_up_list` record and probes it every 5
  min**, as `session_not_active`; the sync sheet says "Not on the follow-up list. Sends
  once an admin adds this unit." Refines D-33-16. _Why:_ an admin listing the unit lets
  the same item through, and nothing unsent is dropped (D-33-2).
- **D-117-17 · The local copy is `v: 2` and carries the session's list (`revisits`,
  null when none was read).** A `v: 1` copy is read as a door-to-door session with no
  list, not deleted, and rewritten on the next online write. The offline shell reads the
  list again, with plain `fetch` and the send timeout, when signal returns, a record is
  sent or held as off the list, or the member comes back to the app; a failed read keeps
  the copy's list. Refines D-77-3. _Why:_ a member offline when this deploys keeps the
  shell; a refusal there must not raise the account message (D-85-1) over a half-typed
  visit.
- **D-117-18 · Before refusing a unit, the recording form reads the list again**, within
  the 4 s limit of D-33-25. With no list at all it queues the visit and the server holds
  it if unlisted. The refusal sits beside Save: "Not saved. This unit is not on the
  follow-up list." An admin is told "You can still record it as an admin" and never
  refused. _Why:_ the member was told to ask an admin, who may just have added it; weak
  signal must not block a save the server would take (D-25-3).
- **D-117-19 · In a follow-up session the form shows the block's listed units as chips,
  guesses no next unit and offers "Back to the list".** Save says "Save and next" only
  once the session is known to be door-to-door; until then it says "Save", using the
  kind another screen already heard (`knownSessionKind`, in memory per page). Refines
  D-25-5. _Why:_ the next door is the next household on the list, not the next number;
  "and next" promised the wrong thing in weak signal. _Research:_ R-80.

### Screens

- **D-117-20 · The kind is chosen once, at creation, from two cards with plain hints**
  ("You can't change this later"). A "Follow-up" badge marks follow-up sessions wherever
  sessions are named; door-to-door carries none. _Why:_ the badge is news only on the
  unusual kind.
- **D-117-21 · `/admin/follow-ups`: To review, On the list, Dismissed, in `?tab=`.**
  Unknown values read as the default (D-29-4); members get `404` (D-28-5). Dismissed is
  read-only and says who removed each note, how, when and why. On `/admin/sessions` a
  "N suggestions to review" card sits with the overdue card under New session; each
  hides at zero, and a failed load is one line. Refines D-35-11. _Why:_ one place to
  decide what is owed; with the notices first, New session sat behind the nav on a short
  iPhone.
- **D-117-22 · Admins list a door where they find it.** "Add to list" on each "Needs a
  return visit" row opens a sheet that says why the door is there ("Showed high interest
  on 3 Mar 2026.") above an empty instruction field; the household header offers "Add to
  follow-up list". `GET /households/attention` now also leaves out households with a
  pending suggestion, and removed notes don't count. Refines D-30-1. _Why:_ the note members read is an
  instruction, not a history fact; a door in the review queue is already being handled.
- **D-117-23 · A follow-up session's admin page shows "Households to revisit (N)".**
  Listed households in blocks the session does not cover are named, with "Add Blk N".
  The list is computed live, so an ended session's list says it is today's. _Why:_ the
  list reaches only attached blocks (D-117-14), so a listed door elsewhere would drop out
  silently.
- **D-117-24 · In a follow-up session the session screen is "Households to revisit".**
  A banner states the rule, households are grouped by block with "N of M visited or
  done", a row opens `/blocks/[id]?unit=` with the unit filled in, and Mark done is a
  separate button. Members see no block cards; admins also get the session's blocks, to
  record off the list. A failed list read stays inside the list. Refines D-24-1. _Why:_
  here the household, not the block, is the unit of work.
- **D-117-25 · Notes split into "On the follow-up list" and "Waiting for review"**,
  pinned above the timeline; a suggestion has a dashed edge. Every member sees
  "Suggested by Ann, waiting for review" (owner, D). Bylines name the suggester and the
  lister, and say "you" to the viewer. Controls come only from `followUpRights`
  (`src/lib/follow-ups/rights.ts`), which mirrors D-117-12; outside the session a member
  reads "You can mark this done during a follow-up session." Refines D-35-6. _Why:_ never
  offer what the server refuses (D-16-2).
- **D-117-26 · Actions are worded by role, and stated where the server would refuse.**
  Admins "Add to follow-up list", members "Suggest a return visit"; otherwise "On the
  follow-up list" or "Suggested by …, waiting for review". A sent suggestion says
  "Suggestion sent. An admin will review it." After a save, only what the household
  allows is offered. "Ask an admin to add it" appears only where nothing can be suggested
  (a unit never visited). Refines D-35-10. _Why:_ one way onto the list, and no offer the
  server refuses.
- **D-117-27 · `/follow-ups`: On the list (default), Waiting for review
  (`?view=review`), Mine (`?view=mine`).** The default is everyone's outstanding listed
  notes. Refines D-35-12. _Why:_ the list admins decide comes first; suggestions are a
  tap away so nobody suggests a door twice.
- **D-117-28 · A member is told when an admin declined their suggestion (owner, E).**
  "Not added to the follow-up list" with the reason, on Follow-ups, for 30 days or until
  Got it. A withdrawn suggestion is not declined. _Why:_ long enough to be seen after a
  week away, short enough not to nag.
- **D-117-29 · First-use hints and the declined notice's Got it are kept in
  `localStorage`: per phone, not per account.** Storage that cannot be used shows the
  hint again; nothing is drawn until after hydration. _Why:_ no schema for UI state, and
  a hint must never flash up for someone who closed it. _Research:_ R-80, R-81.
- **D-117-30 · New `notice-info` utility in `globals.css`** (primary hue) for context
  that changes what a screen allows. Extends D-111-10. _Why:_ a follow-up rule is neither
  an error nor an interest level (D-111-5).
- **D-117-31 · `src/lib/follow-ups/` is a new domain folder** (rights, revisits, the
  listed loader, hints, declined). The server list rule is its own file so the visit
  service imports it without a cycle. Extends D-115-1. _Why:_ UI logic belongs in
  `src/lib` (100% coverage).

### How existing decisions are handled

| Decision                 | Effect                                                                    | By                 |
| ------------------------ | ------------------------------------------------------------------------- | ------------------ |
| D-35-1                   | Superseded (owner)                                                        | D-117-12           |
| D-22-2                   | Edit clause superseded (owner); the read clause stands                    | D-117-12           |
| D-35-12                  | Refined: the default is the listed notes; suggestions have their own view | D-117-27           |
| D-35-6, D-35-10, D-35-11 | Refined: two pinned sections; role-worded actions; listed only, new place | D-117-25/26/21     |
| D-35-2, D-22-1           | Extended: more fields; the removed view's order                           | D-117-6, D-117-5   |
| D-30-1                   | Refined: a pending suggestion also excludes; removed notes don't count    | D-117-22           |
| D-25-5, D-24-1           | Refined for follow-up sessions                                            | D-117-19, D-117-24 |
| D-33-16, D-77-3          | Refined: a new held code; the copy's v2                                   | D-117-16, D-117-17 |
| D-111-10, D-115-1        | Extended: `notice-info`; `src/lib/follow-ups/`                            | D-117-30, D-117-31 |
| D-07-4, D-07-5, D-16-2   | Kept: one active session of any kind; notes stay on the household         | —                  |
| D-20-2, D-21-1, D-74-33  | Kept: amends and replays are never judged against the list                | D-117-15           |
| D-22-3, D-22-4, D-35-8/9 | Kept                                                                      | —                  |

## Known limits

- The offline shell's list has not run on WebKit or a real iPhone: Playwright's WebKit
  offline emulation bypasses the service worker (D-32-18, R-22). The owner checks it by
  hand.
- Hints and the declined notice are per phone (D-117-29).
- A removed note cannot be restored (D-117-4).

## Relies on

D-07-1, D-07-3, D-07-4, D-07-5, D-16-2, D-17-2, D-20-2, D-20-3, D-21-1, D-21-4, D-22-3,
D-22-4, D-25-3, D-25-8, D-28-5, D-29-4, D-33-2, D-33-25, D-35-3, D-35-4, D-35-8, D-35-9,
D-74-32, D-74-33, D-74-44, D-74-61, D-85-1, D-90-2, D-111-5, D-111-7, D-111-36.

## Open questions

None. The owner's answers A to F are recorded above.
