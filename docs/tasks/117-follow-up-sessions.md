# #117 · Follow-up sessions and a reviewed follow-up list

- **Status:** Done (PR #117)
- **Phase:** none (no milestone)
- **Depends on:** #17, #20, #21, #22, #30, #33, #35, #74, #77, #111

## Task

An owner request with no issue. A session is now door-to-door or follow-up; in a
follow-up session the team goes back only to households an admin has picked from the
follow-up list. Members suggest return visits for an admin to review, every removal is
soft, and the UI explains each rule to people using it for the first time.

The owner's request (only admins add to the list; members edit list entries only in a
follow-up session) and answers A to F from two planning rounds were relayed by the
workflow on 2026-10-24 and are in the PR #117 body. Decisions marked **(owner)** come
from them.

A third round, after the owner reviewed the PR, settled four points: reopening while a
suggestion waits, a reason for every removal, households an admin picks for each
follow-up session with at least one, and review leftovers (D-117-32 onwards). The
owner's words: "give a reason for removal then", and "For a follow up session, the admin
will need put which unit to visit and that unit will be tied to a block, hence when the
member open the block it would not be empty. Hence, when creating a follow up session,
validate that there at least need to have 1 unit in the list."

A fourth round, after the owner reviewed the third, uncapped the removal notice, made the
session page name the note a household was picked for, made list counts count
households, and ruled two findings need no change (D-117-51 onwards).

A fifth round came from the owner's own testing in Docker (relayed by the workflow on
2026-10-28): a hydration warning to trace, and "For follow up session, once the household
notes is saved, it should automatically be marked as done. Make an undo the mark done as
well." (D-117-62 onwards).

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
  `delete_reason`, set by ~~`DELETE /follow-ups/{id}?reason=` (at most 500, trimmed, blank
  stored as null)~~. A removed note leaves every list, count, duplicate check and the
  recording rule, is `404` to PATCH and ~~DELETE~~ removal, and cannot be restored; an
  admin adds the household again. _Why:_ the author must be told a suggestion was
  declined, and why. ~~The reason is a query parameter because no DELETE in the contract
  has a body.~~ _Partly superseded by D-117-33 and D-117-34:_ the reason is required and
  travels in the body of `POST /follow-ups/{id}/remove`; the rest stands.
- **D-117-5 · Removed notes are read only through `GET /follow-ups?deleted=true`**,
  newest removal first: admins, or a member whose `authorId` is themself; anyone else
  `403`. Every other read leaves them out. Extends D-22-1. _Why:_ an admin's audit trail;
  a member learns only about their own notes. _Extended by D-117-51:_ `removedByOthers`
  and `deletedSince`.
- **D-117-6 · `FollowUp` gains `blockId`, `status`, `listedAt`, `listedBy`, `deletedAt`,
  `deletedBy`, `deleteReason`.** Extends D-35-2. Only listed notes are owed: a
  household's `outstandingFollowUps`, the overdue card and "Overdue" count them alone,
  and a suggestion's date reads "Go back by". _Why:_ a client can tell which notes a
  session's blocks cover without a lookup; a suggestion's date is a wish until listed.
  _Extended by D-117-32:_ `waitingSuggestionBy`.

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
  _Refined by D-117-32:_ an admin's reopen also lists a suggestion waiting at the door.
- **D-117-11 · A suggestion has no done state.** `done` on it is `409 conflict`, unless
  an admin promotes it in the same body. _Why:_ nothing is owed until it is listed.
- **D-117-12 · Who may change a note (owner, request item 2, C and E).** Admins: anything,
  any time. A suggestion: its author may reword, re-date or withdraw it at any time;
  anyone else `403`. A listed note: a member may resolve or reopen it only while it is on
  the running follow-up session's list (D-117-14), otherwise
  `409 not_on_follow_up_list`; rewording or re-dating also needs the author (`403`), and
  removing it is admin-only (`403`, the author included). Refusals in the order `404`,
  `403`, `409`. Supersedes D-35-1 and D-22-2's edit clause. _Why:_ only an admin decides
  what is owed, and members edit list entries only in a follow-up session. _Refined by
  D-117-32 and D-117-40:_ a member's reopen is refused while a suggestion waits; the list
  is D-117-40's.

### The list and recording

- **D-117-13 · `GET /sessions/{id}/revisits` returns a follow-up session's list.**
  Members read the active session's only (`403` otherwise); admins any status, so a
  draft's list can be checked before starting it. A regular session is `409 conflict`.
  Not paginated, and fixed in query count (D-20-3). _Why:_ an admin builds the list by
  hand, so it stays short. _Order refined by D-117-42; note order by D-117-54._
- ~~**D-117-14 · One list rule, `onRevisitList` (`src/server/follow-ups/list-rule.ts`).**
  Listed, not removed, in one of the session's attached blocks, and outstanding or
  resolved since the session started; a draft counts outstanding only. It decides the
  revisits list, the recording refusal and D-117-12's session check. _Why:_ the list and
  its refusals cannot disagree (an integration test compares them case by case); a door
  marked done tonight stays on tonight's list, and one done last month is not tonight's
  work.~~ Superseded by D-117-40.
- **D-117-15 · In a follow-up session a member records only at listed households (owner,
  B and F).** Any other new visit is `409 not_on_follow_up_list` on `POST /visits`, and
  a sync item is `rejected` with the same code. The caller's role decides, so an admin is
  exempt, also recording on a member's behalf. Amending a stored visit, by PATCH or sync,
  is never judged. In sync the check follows the session, clock and block checks, so an
  ended session still answers `session_not_active`. Regular sessions are unchanged.
  _Why:_ an amend corrects what was allowed when it was recorded (D-20-2, D-74-32). The
  rule is about who chooses the door; D-74-33 still governs amends. _Refined by D-117-40
  and D-117-45:_ the list is the picked households'; the check runs inside the write's
  transaction, under the session lock. _Refined by D-117-65:_ a new visit on the list
  also marks the household's owed listed notes done.
- **D-117-16 · The queue holds a `not_on_follow_up_list` record and probes it every 5
  min**, as `session_not_active`; the sync sheet says "Not on the follow-up list. Sends
  once an admin adds this unit." Refines D-33-16. _Why:_ an admin listing the unit lets
  the same item through, and nothing unsent is dropped (D-33-2). _Wording refined by
  D-117-47:_ "Not on this session's list."; the unit must be listed and picked.
- **D-117-17 · The local copy is `v: 2` and carries the session's list (`revisits`,
  null when none was read).** A `v: 1` copy is read as a door-to-door session with no
  list, not deleted, and rewritten on the next online write. The offline shell reads the
  list again, with plain `fetch` and the send timeout, when signal returns, a record is
  sent or held as off the list, or the member comes back to the app; a failed read keeps
  the copy's list. Refines D-77-3. _Why:_ a member offline when this deploys keeps the
  shell; a refusal there must not raise the account message (D-85-1) over a half-typed
  visit. _Refined by D-117-48:_ the list alone makes the copy usable.
- **D-117-18 · Before refusing a unit, the recording form reads the list again**, within
  the 4 s limit of D-33-25. With no list at all it queues the visit and the server holds
  it if unlisted. The refusal sits beside Save: "Not saved. This unit is not on the
  follow-up list." An admin is told "You can still record it as an admin" and never
  refused. _Why:_ the member was told to ask an admin, who may just have added it; weak
  signal must not block a save the server would take (D-25-3). _Wording refined by
  D-117-47:_ "This unit is not on this session's list."
- **D-117-19 · In a follow-up session the form shows the block's listed units as chips,
  guesses no next unit and offers "Back to the list".** Save says "Save and next" only
  once the session is known to be door-to-door; until then it says "Save", using the
  kind another screen already heard (`knownSessionKind`, in memory per page). Refines
  D-25-5. _Why:_ the next door is the next household on the list, not the next number;
  "and next" promised the wrong thing in weak signal. _Research:_ R-80. _Refined by
  D-117-59:_ Back to the list has its own row; _by D-117-71 and D-117-77:_ a follow-up
  row with Undo, and only the line is scrolled into view.

### Screens

- **D-117-20 · The kind is chosen once, at creation, from two cards with plain hints**
  ("You can't change this later"). A "Follow-up" badge marks follow-up sessions wherever
  sessions are named; door-to-door carries none. _Why:_ the badge is news only on the
  unusual kind. _Refined by D-117-39:_ Follow-up also picks the households.
- **D-117-21 · `/admin/follow-ups`: To review, On the list, Dismissed, in `?tab=`.**
  Unknown values read as the default (D-29-4); members get `404` (D-28-5). Dismissed is
  read-only and says who removed each note, how, when and why. On `/admin/sessions` a
  "N suggestions to review" card sits with the overdue card under New session; each
  hides at zero, and a failed load is one line. Refines D-35-11. _Why:_ one place to
  decide what is owed; with the notices first, New session sat behind the nav on a short
  iPhone. _Refined by D-117-50:_ counts under the labels, the hint under the list; _by
  D-117-56:_ On the list counts and groups households.
- **D-117-22 · Admins list a door where they find it.** "Add to list" on each "Needs a
  return visit" row opens a sheet that says why the door is there ("Showed high interest
  on 3 Mar 2026.") above an empty instruction field; the household header offers "Add to
  follow-up list". `GET /households/attention` now also leaves out households with a
  pending suggestion, and removed notes don't count. Refines D-30-1. _Why:_ the note members read is an
  instruction, not a history fact; a door in the review queue is already being handled.
  _Refined by D-117-46:_ each place also offers "Also add to {session}".
- ~~**D-117-23 · A follow-up session's admin page shows "Households to revisit (N)".**
  Listed households in blocks the session does not cover are named, with "Add Blk N".
  The list is computed live, so an ended session's list says it is today's. _Why:_ the
  list reaches only attached blocks (D-117-14), so a listed door elsewhere would drop out
  silently.~~ Superseded by D-117-43.
- **D-117-24 · In a follow-up session the session screen is "Households to revisit".**
  A banner states the rule, households are grouped by block with "N of M visited or
  done", a row opens `/blocks/[id]?unit=` with the unit filled in, and Mark done is a
  separate button. Members see no block cards; admins also get the session's blocks, to
  record off the list. A failed list read stays inside the list. Refines D-24-1. _Why:_
  here the household, not the block, is the unit of work. _Refined by D-117-75:_ Mark
  done is for a door finished without a visit, and a Done row offers Reopen.
- **D-117-25 · Notes split into "On the follow-up list" and "Waiting for review"**,
  pinned above the timeline; a suggestion has a dashed edge. Every member sees
  "Suggested by Ann, waiting for review" (owner, D). Bylines name the suggester and the
  lister, and say "you" to the viewer. Controls come only from `followUpRights`
  (`src/lib/follow-ups/rights.ts`), which mirrors D-117-12; outside the session a member
  reads "You can mark this done during a follow-up session." Refines D-35-6. _Why:_ never
  offer what the server refuses (D-16-2). _Refined by D-117-32 and D-117-47:_ a waiting
  suggestion is said in place of Reopen; "…that includes this household"; _by
  D-117-74:_ at the door, no Mark done on a note the save will mark.
- **D-117-26 · Actions are worded by role, and stated where the server would refuse.**
  Admins "Add to follow-up list", members "Suggest a return visit"; otherwise "On the
  follow-up list" or "Suggested by …, waiting for review". A sent suggestion says
  "Suggestion sent. An admin will review it." After a save, only what the household
  allows is offered. "Ask an admin to add it" appears only where nothing can be suggested
  (a unit never visited). Refines D-35-10. _Why:_ one way onto the list, and no offer the
  server refuses. _Refined by D-117-47:_ a listed household not picked says "ask an
  admin to add it to this session".
- **D-117-27 · `/follow-ups`: On the list (default), Waiting for review
  (`?view=review`), Mine (`?view=mine`).** The default is everyone's outstanding listed
  notes. Refines D-35-12. _Why:_ the list admins decide comes first; suggestions are a
  tap away so nobody suggests a door twice.
- **D-117-28 · A member is told when an admin declined their suggestion (owner, E).**
  "Not added to the follow-up list" with the reason, on Follow-ups, for 30 days or until
  Got it. A withdrawn suggestion is not declined. _Why:_ long enough to be seen after a
  week away, short enough not to nag. _Extended by D-117-35:_ also a listed note someone
  else removed, under "Not on the follow-up list". _Refined by D-117-52:_ every one in the
  window, filtered on the server.
- **D-117-29 · First-use hints and the declined notice's Got it are kept in
  `localStorage`: per phone, not per account.** Storage that cannot be used shows the
  hint again; nothing is drawn until after hydration. _Why:_ no schema for UI state, and
  a hint must never flash up for someone who closed it. _Research:_ R-80, R-81. _Refined
  by D-117-53:_ Got it to all.
- **D-117-30 · New `notice-info` utility in `globals.css`** (primary hue) for context
  that changes what a screen allows. Extends D-111-10. _Why:_ a follow-up rule is neither
  an error nor an interest level (D-111-5).
- **D-117-31 · `src/lib/follow-ups/` is a new domain folder** (rights, revisits, the
  listed loader, hints, declined). The server list rule is its own file so the visit
  service imports it without a cycle. Extends D-115-1. _Why:_ UI logic belongs in
  `src/lib` (100% coverage).

### Third round: reopening and removal

- **D-117-32 · Reopening while a suggestion waits: an admin's reopen lists it; a
  member's is `409 follow_up_exists`.** The admin's lists the suggestion in the same
  transaction (`listedBy` the admin, `listedAt` now); the member is told whose suggestion
  waits and to ask an admin. Judged under the household lock (D-117-9).
  `FollowUp.waitingSuggestionBy` names the suggester, so the screen says this in place of
  Reopen, and a stale Reopen says why and re-reads. Refines D-22-4, D-117-10, D-117-12.
  _Why:_ a reopened note beside a waiting suggestion is the state D-117-8 refuses, and
  dismissing the suggestion would tell its author "declined" when it was not. _Refined by
  D-117-57:_ the stale Reopen's alert is "Not reopened."; one sentence and name rule.
- **D-117-33 · Every removal needs a reason (owner).** Dismiss, remove and withdraw: 1 to
  500 characters, not only spaces, stored trimmed, else `400`. The button waits with
  "Write a reason to continue." and the sheet says who will read it. Supersedes
  D-117-4's optional reason. _Why:_ the owner asked for one; an author told of a removal
  is owed the why.
- **D-117-34 · The reason travels in a body: `POST /follow-ups/{id}/remove`**, replacing
  `DELETE /follow-ups/{id}?reason=`. Supersedes D-117-4's query parameter. _Why:_ free
  text about a household must not land in a URL, and so in proxy and access logs; a POST
  because a DELETE's body has no defined meaning in HTTP. _Research:_ R-83.
- **D-117-35 · The author is told of any removal made by someone else.** The notice on
  Follow-ups, now headed "Not on the follow-up list", also shows a listed note taken off:
  "Removed from the follow-up list by Ben · 3 Mar 2026: {reason}", beside "Declined by
  …". Withdrawing or removing your own note shows you nothing; admins read every removal
  under Dismissed. Extends D-117-28. _Why:_ the removal sheet promised "Ann and admins
  will see this", and no member screen showed it. _Refined by D-117-52 and D-117-53:_
  uncapped; the newest three, then Show all.

### Third round: households picked for each follow-up session

- **D-117-36 · A follow-up session goes back to households an admin picks (owner).** New
  table `session_households` (`session_id`, `household_id`, `added_at`; migration
  `0003`). A pick is a household, not a note: notes still attach to the household
  (D-07-5), and a listed household left unpicked stays on the list for a later session.
  _Why:_ the owner's words (Task); picking households keeps D-07-5.
- **D-117-37 · Its blocks follow its picks (owner).** Every add and remove keeps
  `session_blocks` equal to the picks' blocks; attaching or detaching a block on a
  follow-up session is `409 conflict`, and its page shows blocks read-only. So members
  only meet blocks holding picks. Regular sessions are unchanged. Refines D-18-1 and
  D-18-2 (regular sessions only). _Why:_ the owner: a member must never open an empty
  block.
- **D-117-38 · At least one household, from creation on (owner).** `POST /sessions` with
  `kind: follow_up` needs `householdIds` (1 to 200), else `400` "Pick at least one
  household to visit."; `blockIds` on it, or `householdIds` on a regular one, is `400`.
  Each pick needs a listed, live, outstanding note: unknown `404`, unlisted
  `409 not_on_follow_up_list`, all or nothing. _Why:_ the owner's rule, held by the
  server whatever a stale screen sent.
- **D-117-39 · Creating one offers the whole follow-up list, all ticked.** Grouped by
  block, each household with its first note ("+N more"), "N of M households ticked" and
  Untick all / Tick all. Create draft waits and says why beside it; with nothing on the
  list the Follow-up card links to it. Refines D-117-20. _Why:_ the list is usually the
  session, so unticking is the exception; a held button says what it waits for.
- **D-117-40 · The list rule: picked for the session, with a listed, live note owed or
  resolved since it started (a draft: owed only).** Still one predicate, `onRevisitList`,
  behind the revisits list, the recording refusal (D-117-15) and the member-edit check
  (D-117-12); the integration test compares the three case by case, picked and not. ~~The
  client mirror reads `ActiveSession.householdIds`.~~ Supersedes D-117-14. _Why:_ a block
  no longer says which doors a session is for; the list and its refusals still cannot
  disagree. _Refined by D-117-55:_ a resolution counts from the later of the start and
  the pick; the mirror reads `ActiveSession.picks`.
- **D-117-41 · Picks are sticky.** Resolving or removing a note never changes picks, and
  removing a note is never refused because a session picked it: the household leaves
  that session's list, and returns if it is listed or reopened again. _Why:_ the
  follow-up list stays the admin's to change at any time, and picks stay a truthful
  record of what the session set out to do.
- **D-117-42 · Changing picks: admins, draft or running.** Read and add with
  `/sessions/{id}/households`, remove with `DELETE …/{householdId}`. Adding follows
  D-117-38; already picked is a no-op. Removing is refused in the order `404` not
  picked, then `409` ended, visited in this session, the last household, then
  `block_in_use` when its block would leave holding this session's visits. Reading works
  in any status; a regular session is `409` to read or add, `404` to remove. Picks and
  the revisits list order by block name, street, then unit.
  _Why:_ a visit is the session's work and history is never orphaned (D-18-3); only
  `(name, street)` is unique. _Kept by the owner, D-117-60:_ the last-household count
  includes picks off the list.
- **D-117-43 · A follow-up session's admin page lists its picks.** "Households to revisit
  (N)" by block, each with its first note and a state: Visited, Done, "Already done" or
  "Done before it started" (resolved since `addedAt`), or "Off the follow-up list".
  "Members see N of these" when fewer are on the list. Remove asks first and is withheld,
  with the reason, where the server would refuse; Add households offers the rest of the
  list, unticked. An ended session's picks are frozen and read "as they stand today";
  reopening unfreezes them. Supersedes D-117-23. _Why:_ blocks follow picks, so no "Add
  Blk N"; never offer what the server refuses. _Refined by D-117-54:_ the row names the
  note the pick was for, not the first note.
- **D-117-44 · A follow-up draft starts only with something on its list.** Otherwise
  `POST /sessions/{id}/start` is `409 conflict`, checked under the session row lock, and
  Start waits with the reason. Reopening is not checked. _Why:_ members would open an
  empty list, what D-117-38 exists to prevent; reopen is the recovery path (D-17-1).
- **D-117-45 · One lock order on the session row.** Pick changes and transitions take it
  `FOR UPDATE`; `POST /visits` and each sync item take it `FOR KEY SHARE` first, then
  judge the session, block and list inside the write's transaction, before the household
  upsert. Follow-up writes keep household then note (D-117-9) and never lock a session.
  _Why:_ a remove and a record each see the other, two admins cannot remove the last two
  picks at once, and record versus add cannot deadlock; parked-lock tests hold each.
  _Research:_ R-82, R-35. _Refined by D-117-69:_ a visit's transaction marks notes last,
  after the household.
- **D-117-46 · "Also add to {session}" wherever an admin lists a door.** The household
  page, a "Needs a return visit" row, the recording form and listing a suggestion (now a
  sheet that shows it first) offer it, ticked, for the running follow-up session, else
  the newest draft. Two requests: a failed session step is said and only it is retried;
  one the server refused gives its reason and Done. Refines D-117-22. _Why:_ one
  predictable box rather than a choice of sessions; the second step must neither undo
  nor repeat the first.

### Third round: screens and leftovers

- **D-117-47 · Refusals name the session's list.** "Not on this session's list" in the
  form and the sync sheet; a household on the follow-up list but not picked adds "ask an
  admin to add it to this session"; a locked note reads "…during a follow-up session
  that includes this household". A block screen for a block outside the running session,
  of either kind, says so with Go to Session and offers no form. Refines D-117-16,
  D-117-18, D-117-25, D-117-26. _Why:_ the session's picks, not the follow-up list, now
  decide; a form that refuses every unit helps nobody. _Refined by D-117-58:_ a session
  block with nothing on the list says so above its form.
- **D-117-48 · Offline, a follow-up session's list alone is enough.** A copy holding the
  list and no opened block is usable; the shell's home is "Households to revisit", and a
  block never opened is built from the list with only its listed households, and says
  so. With a list saved, only its blocks are offered. After Continue the shell opens the
  block and unit the failed address named, in either kind. The copy's contents are
  unchanged. Refines D-117-17, D-77-3, D-77-4, D-77-12. _Why:_ in the stairwell, a member
  who read the list but opened no block had nothing to record with. _Kept by the owner,
  D-117-61:_ a row's interest chip may lag until sync.
- **D-117-49 · Day-neutral words.** The block card reads "visited in this session" and
  unit rows are marked "this session". Refines D-111-7's "N visited tonight" and D-26-2's
  `tonight`. _Why:_ sessions run in the daytime too.
- **D-117-50 · Review leftovers.** `useActiveSession` and the removal notice lose their
  unmount guards, and the hollow test goes; `/admin/follow-ups` tab counts sit under
  their labels (heard as "To review, 3") and the first-use hint moves under the list; a
  sheet title keeps 12ch of body text before Cancel drops under it. Refines D-117-21 and
  D-111-25. _Why:_ a guard no test can observe is dead code; the tabs wrapped at 393px,
  the hint pushed the first action below the fold, and "Add households" stood a word a
  line. _Refined by D-117-56:_ On the list counts households.

### Fourth round: removal notices

- **D-117-51 · `GET /follow-ups` gains `removedByOthers` and `deletedSince`.** Both are
  valid only with `deleted=true`, else `400`, judged before any `403` (as D-83-15). `true`
  gives notes removed by someone other than their author, `false` the author's own
  withdrawals. Who may read is unchanged (D-117-5), so `total` is the true count of what
  an author is told. Both list orders end on the id. Extends D-117-5 and D-22-1. _Why:_
  filtering on the phone let withdrawals and seen notices use up a capped page; ties
  without a unique order can repeat or skip rows across offset pages. _Research:_ R-84.
- **D-117-52 · The removal notice reads every page (owner).** The last 30 days' removals
  by others, 100 a page to the end, then drops those seen on this phone. Every
  whole-list read of follow-ups (the notice, the New session picker, Add households, On
  the list) goes through `loadAllFollowUps`, which keeps each note once by id. Refines
  D-117-28, D-117-35. _Why:_ the author is owed every reason; as D-74-61 for users. A
  note leaving between two pages can still hide another until the next read: accepted.
- **D-117-53 · The notice shows the newest three.** "Show all (N)" / "Show fewer" when
  there are more, "Got it to all" (one storage write) when there are two or more, both
  under the heading above the notes; each note keeps its Got it. Refines D-117-29,
  D-117-35. _Why:_ a backlog must not bury the Follow-ups list; below the notes, the
  controls sat under the nav or the fold on arrival at phone width.

### Fourth round: the picked note and counts

- **D-117-54 · One note order for picks and the revisits list; a row names the note it
  was picked for (owner).** Owed by due day (undated last), then resolved, most recently
  resolved first. The session page row shows `pickNote`: the first owed note, else the
  newest resolved since the pick, never one resolved before it (then none).
  `GET /follow-ups` keeps D-22-1. Refines D-117-13, D-117-43. _Why:_ oldest-resolved
  first named a note done in March, read as "Already done", in place of the one picked;
  the first owed note is the one the picker showed (D-117-39).
- **D-117-55 · A resolution counts from the later of the session's start and the pick.**
  `onRevisitList` holds each note to its pick's `added_at`, and so does the client
  mirror: `GET /sessions/active` carries `picks` (`householdId`, `addedAt`) in place of
  `householdIds`. Draft picks are unaffected; they precede the start. Refines D-117-40.
  _Why:_ a door added to a running session for one note kept another, resolved earlier
  in the session, as Done, and stayed on members' list once its owed note left; the
  list, the row (D-117-54) and the refusals must agree.
- **D-117-56 · "On the list" counts households, and groups their notes (owner).** The
  `/admin/follow-ups` tab reads the whole list (no Show more), counts distinct
  households as the New session picker does, and shows each door once with its listed
  notes and their controls under it. To review needs no change (D-117-7). The overdue
  card still counts notes ("N overdue follow-ups"). Refines D-117-21, D-117-50. _Why:_
  one list read "5" there and "4 of 4 households ticked" in the picker once a household
  carried two listed notes, which D-117-32 can cause.

### Fourth round: leftovers and rulings

- **D-117-57 · A refused reopen is said once, in one sentence.** A stale Reopen's alert
  is "Not reopened."; the re-read's caption says whose suggestion waits. The member's
  `409` and the caption share `waitingSentence`: first name, "Your" to the suggester,
  "Someone's" with no name. The name helpers move to `src/lib/session/own-name.ts`,
  which the server can import. Refines D-117-32. _Why:_ the alert repeated the caption,
  and the `409` used the full name where the screen used the first.
- **D-117-58 · A session block with nothing on the session's list says so.** A member
  there (a bookmark, or a block whose only pick left the list, D-117-41) reads "Nothing
  in this block is on this session's list." with Back to the list, above a form that
  stays. Not shown to admins, nor before the list is read. Refines D-117-47. _Why:_ a
  bare form refused every unit unexplained; a re-read that empties the block must not
  throw away a half-typed visit.
- **D-117-59 · In a follow-up session the Saved line's "Back to the list" has its own
  row.** Refines D-117-19. _Why:_ the line grew a row from "Sending…" to "Saved … on this
  phone." just after Save scrolled it into view, and scroll anchoring pushed it under
  the pinned count; an E2E holds its height. _Research:_ R-85. _Refined by D-117-71:_
  the follow-up row is there from "Sending…" on, for the same reason.
- **D-117-60 · The last-household rule counts every pick, on the list or not (owner, no
  change).** D-117-42 stands, so a running session can be left with nothing on members'
  list. _Why:_ the owner: admins "can do that on the fly as they would remove and add
  another household anyways for flexibility purposes."
- **D-117-61 · Offline, a visited row's interest chip may lag until sync (owner, no
  change).** In the shell's Households to revisit, a row reads Visited from what the
  phone holds while its chip shows the latest visit as last read with signal, until the
  visit sends and the list is read again. _Why:_ the owner ruled it fine; the copy keeps
  the list as read (D-117-48).

### Fifth round: hydration

- **D-117-62 · The owner's hydration warning was a browser extension: no code change.**
  The dev overlay's attribute warning came from Grammarly's `data-new-gr-c-s-check-loaded`
  and `data-gr-ext-installed` on `<body>`, the only difference in the dev server's
  forwarded log. A clean Chromium in Asia/Singapore against the same Docker app, and a
  native server under `TZ=UTC`, reported nothing on any page for admin or member. No
  `suppressHydrationWarning`. _Why:_ the brief asked for evidence before code; silencing
  `<body>` would also hide a real mismatch there. _Research:_ R-86.
- **D-117-63 · The root layout's chrome reads the route it rendered, not the address.**
  `useRoutePathname` (`src/lib/hooks/`) is `/offline` when the rendered segment is, else
  `usePathname()`; the nav, sync bar, queue, account check and install banner use it.
  Fixes React #418 on every cold offline reload of `/` and `/blocks/{id}`. Refines
  D-77-12. _Why:_ the worker serves the prerendered `/offline` at the failed address,
  where `usePathname()` reads that address on the client, so the chrome drew what the
  server had left out and React threw the server's HTML away. _Research:_ R-87.
- **D-117-64 · The E2E phone and server are a day apart, and any hydration error fails a
  test.** The browser runs at `Pacific/Kiritimati` (UTC+14), the server under
  `TZ=Etc/GMT+12` (UTC−12). Every page a fixture hands out fails on React's hydration
  errors and on a sweep comparing each hydrated element's attributes, booleans included,
  with the props React rendered: every 100 ms for 2 s after load, at `pagehide` and at
  teardown, kept in `sessionStorage`. No new spec (D-37-6). _Why:_ production React keeps
  a differing server attribute silently, and Singapore and UTC share a date for most of
  the day, so a date bug would pass at the wrong hour. _Research:_ R-86, R-88.

### Fifth round: saving marks the follow-up done

- **D-117-65 · A new visit at a household on a running follow-up session's list marks
  its owed listed notes done (owner).** In the visit's transaction, on `POST /visits`
  and `/visits/sync` alike, for members and admins, at any interest level (the brief's
  "every outstanding listed note"). An admin off the list, an amend, a replay or
  duplicate id, a regular session, a suggestion, a removed note or one already done
  marks nothing. Refines D-117-15. _Why:_ the owner's request; on the server, so a
  queued visit counts too. Whether "No response" should is an open question.
- **D-117-66 · Credited to the visit's author, at the server's time. _Pending the
  owner._** `doneBy` is the visit's member, so Record for a member credits the member,
  not the admin that the brief's "the recorder" would name; `doneAt` is when the visit
  is stored. _Why:_ the visit and its team stamp are the member's (D-29-2) and the admin
  acts for them; every resolution is stamped by the server (D-35-9).
- **D-117-67 · `follow_ups.done_visit_id` names the visit that marked a note (migration
  `0004`).** Nullable FK to `visits`, `on delete set null`, partial index, no backfill;
  null for a note marked by hand; any reopen clears it. Extends D-22-4. _Why:_ a replay
  or a lost reply must name the same notes without marking again (D-07-3, D-21-1), and
  Undo must know exactly what a save closed.
- **D-117-68 · Recording answers a `RecordedVisit`.** `POST /visits`'s `201` and each
  sync result with a visit carry a required `followUpsMarkedDone`: the notes that visit
  marked and that are still done, read from `done_visit_id`. `Visit` and `RecordedVisit`
  are each `allOf` `VisitFields` with `unevaluatedProperties: false`, so no other read
  carries the field (D-12-2). _Why:_ required, an answer that drops it fails a test and
  the client never guesses; only a recording has something to undo. _Research:_ R-90.
- **D-117-69 · The lock order is unchanged: session, household, notes.** Marking runs
  after the insert, under the session's `FOR KEY SHARE` and the household upsert's row
  lock, and touches only notes still owed, so a Mark done that holds the door first
  keeps its resolver. Refines D-117-45; keeps D-117-9 and D-35-8. _Why:_ one order, so a
  record and a Mark done never deadlock; parked-lock tests hold both interleavings.
- **D-117-70 · Undo is `PATCH /follow-ups/{id}` with `done: false` and
  `markedByVisit`.** It reopens a note only while that visit is still what marked it
  done: one marked done again since is `409 conflict` ("Ben marked it done again after
  this visit was saved, so it stays done.") and stays done; one already owed is left as
  it is; `markedByVisit` without `done: false` is `400`. D-117-12 and D-117-32 are judged
  first. It never touches the visit. Extends D-35-8 to Undo. _Why:_ a stale Saved line
  must not take back someone's later resolution.
- **D-117-71 · The Saved line says what the save marked, with Undo.** In a follow-up
  session it has a follow-up row from "Sending…" on: "Follow-up marked done once sent."
  (from the list as last read), then "Follow-up marked done." with Undo, then "Undone.
  Follow-up reopened.", "Not undone. {the server's reason}", or "Not undone. Check your
  signal and try again." with Undo kept. Undo is at least 44 by 44px and disabled
  without signal; a save that marked nothing says nothing. Refines D-117-19, D-117-59.
  _Why:_ the owner asked for Undo; a row there from the start keeps the line one height.
- **D-117-72 · Undo lasts as long as its Saved line.** Until another unit is typed or
  picked, the next save, or leaving. A late answer for a save no longer shown is
  dropped, and the double-tap guard is per save. Each Undo re-reads the list and the
  block. _Why:_ usable without racing the next door; one save's answer must never
  relabel the next.
- **D-117-73 · A queued visit marks notes when it lands; Undo needs signal (owner).**
  Sync marks them when the item is first stored, possibly hours later, including a
  record held as off the list once it is listed and sent. No note change is itself
  queued, and the offline shell never offers Undo: the list's Reopen does, with signal.
  Refines D-35-9. _Why:_ the brief asked that offline saves count; a queued reopen would
  be the offline follow-up change D-35-9 still rules out.
- **D-117-74 · At the door, the save is what marks a listed note done.** In a follow-up
  session a note the save will mark (`marksDoneOnSave`) offers no Mark done on the
  recording form, and the section says "Saving your visit marks this done."; Edit and
  Remove stay. Admins off the list, door-to-door sessions and the household page keep
  Mark done. Extends D-35-7; refines D-117-25. _Why:_ the owner replaced the mark at the
  door with the save; two ways there would ask the member to choose.
- **D-117-75 · The revisit list keeps Mark done and gains Reopen on Done rows.** Mark
  done is for a door finished without a visit. Reopen shows only where the viewer may
  reopen every note on the row, and reopens every done note there, not only those a
  visit marked (accepted); a waiting suggestion's caption shows instead. After Undo or
  Reopen the row reads Visited and "N of M visited or done" is unchanged; the hint says
  so. Refines D-117-24. _Why:_ the brief sends offline Undo to Reopen, and `FollowUp`
  does not expose `done_visit_id`.
- **D-117-76 · Record for a member says what it marked done, with the same Undo.**
  `/admin/records` reads "Saved #05-123 for Ann. Follow-up marked done." until the next
  record or leaving; Undo is disabled without signal. An admin's Undo, there or on the
  Saved line, also lists a suggestion that arrived after the save, unwarned (D-117-32;
  accepted, the window is seconds). _Why:_ the admin was never told the note became
  "Done by Ann".
- **D-117-77 · Each save scrolls the Saved line itself into view**, not the wrapper with
  the unit field and the block's chips. Refines D-111-69. _Why:_ with about ten listed
  doors in a block that wrapper outgrew a Pixel 5, and `block: "nearest"` aligned its
  bottom, leaving the line and Undo above the screen; the E2E now lists twelve.
  _Research:_ R-89.

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
| D-22-3                   | Kept                                                                      | —                  |
| D-117-4                  | Partly superseded (owner): the reason is required, sent in a POST body    | D-117-33/34        |
| D-117-14, D-117-23       | Superseded: picks decide the list; the session page lists its picks       | D-117-40/43        |
| D-22-4, D-117-10/12      | Refined: a reopen lists a waiting suggestion, or waits for an admin       | D-117-32           |
| D-117-6, D-117-28        | Extended: `waitingSuggestionBy`; the author sees a removed listed note    | D-117-32/35        |
| D-18-1, D-18-2           | Refined (owner): regular sessions only; a follow-up's blocks follow picks | D-117-37           |
| D-117-20, D-117-22       | Refined: households picked at creation; "Also add to {session}"           | D-117-39/46        |
| D-117-13                 | Refined: ordered by block name, street, then unit                         | D-117-42           |
| D-117-16/18/25/26        | Refined: the wording names the session's list                             | D-117-47           |
| D-117-17, D-77-3/4/12    | Refined: the list alone is usable; the failed address's block opens       | D-117-48           |
| D-111-7, D-26-2          | Wording: "this session", not "tonight"                                    | D-117-49           |
| D-117-21, D-111-25       | Refined: tab counts, the hint's place, a sheet title's width              | D-117-50           |
| D-07-5, D-17-2, D-18-3   | Kept: picks are households; the clash is the database's; `block_in_use`   | D-117-36/44/42     |
| D-117-5, D-22-1          | Extended: the removal filters; the id ends both orders                    | D-117-51           |
| D-117-28/29/35           | Refined: every removal in the window; newest three, Got it to all         | D-117-52/53        |
| D-117-13, D-117-43       | Refined: one note order; the row names the note picked for                | D-117-54           |
| D-117-40                 | Refined: resolved since the later of start and pick; `picks`              | D-117-55           |
| D-117-21, D-117-50       | Refined: On the list counts and groups households                         | D-117-56           |
| D-117-32/47, D-117-19    | Refined: "Not reopened."; the empty-block line; the Saved line's row      | D-117-57/58/59     |
| D-117-42, D-117-48       | Kept (owner): the last-household count; the shell's interest chip         | D-117-60/61        |
| D-77-12                  | Refined: while hydrating, the chrome reads the rendered route             | D-117-63           |
| D-37-6                   | Kept: the hydration guard lives in the fixtures, not a new spec           | D-117-64           |
| D-117-15, D-117-45       | Refined: a new visit on the list marks notes done, last in its lock order | D-117-65/69        |
| D-35-8, D-22-4           | Extended: Undo never takes back a later resolution; reopen clears a link  | D-117-70/67        |
| D-35-9                   | Refined (owner): a queued visit marks notes when it lands                 | D-117-73           |
| D-117-19/59, D-111-69    | Refined: the Saved line's follow-up row; only the line is scrolled        | D-117-71/77        |
| D-35-7, D-117-25         | Extended, refined: at the door the save marks a listed note done          | D-117-74           |
| D-117-24                 | Refined: Mark done without a visit; Reopen on Done rows                   | D-117-75           |

## Known limits

- The offline shell's list, including the stairwell of D-117-48, has not run on WebKit
  or a real iPhone: Playwright's WebKit offline emulation bypasses the service worker
  (D-32-18, R-22). The owner checks it by hand.
- Hints and the removal notice are per phone (D-117-29).
- A removed note cannot be restored (D-117-4).
- One request picks at most 200 households (D-117-38); a longer list is added in parts
  from the session's page.
- A note that leaves the follow-up list while a whole-list read is between pages can
  hide another until the next read (D-117-52).
- Undo needs signal; a save sent from the offline shell is undone with the list's Reopen
  (D-117-73).
- The E2E attribute sweep reads React's undocumented `__reactProps$` key; a React
  upgrade may need it changed (R-86).

## Relies on

D-07-1, D-07-2, D-07-3, D-07-4, D-07-5, D-12-2, D-16-2, D-17-1, D-17-2, D-18-3, D-20-2,
D-20-3, D-21-1, D-21-4, D-22-3, D-25-3, D-25-8, D-28-5, D-29-2, D-29-4, D-33-2,
D-33-25, D-35-3, D-35-4, D-35-8, D-35-9, D-37-6, D-74-32, D-74-33, D-74-44, D-74-61,
D-77-13, D-83-15, D-85-1, D-90-2, D-111-5, D-111-7, D-111-36.

## Open questions

- **Should a "No response" visit close the note? (D-117-65)** As built, yes, as the
  brief said. Then the row reads Done, and no later follow-up session can pick the
  household (D-117-38) until someone taps Undo or Reopen. Excluding it is one condition
  in `markDoneByVisit` plus the at-door caption and the hint.
- **Who is credited when an admin records for a member? (D-117-66)** The brief named
  the recorder; as built it is the visit's author. Switching is one argument in
  `createVisit`'s call, and the records screen would then name the admin.
- **A household recorded before it was picked reads Visited.** An admin's record
  earlier in the session, before the household was listed and picked, makes the
  member's row Visited and counts it in "N of M visited or done" while its note is still
  owed. Changing it needs a "visited since picked" field on both lists, since
  `visitedInSession` also decides whether a pick may be removed (D-117-42).

The owner's answers A to F, the third round's four points and the fourth round's
rulings are recorded above.
