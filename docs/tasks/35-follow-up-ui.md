# #35 · Follow-up notes UI

- **Status:** Done (PR #96)
- **Phase:** 7 - Hardening
- **Depends on:** #22

## Task

Timeline interleaving visits and notes; add, mark done, overdue styling; notes on the
recording form before knocking; overdue widget for admins.

## Decisions

- ~~**D-35-1 · Any member may resolve or reopen a note; text, due date and delete stay
  with the author or an admin.** A body with `done` plus `note` or `dueDate` is judged
  as an edit (403 for a non-author). _Why:_ whether a promise was kept is a fact about
  the household, and `doneBy` keeps it attributable. Already shipped in 53349a6 (#22).
  Supersedes D-22-2's resolve clause (owner agreed).~~ Superseded by D-117-12.
- **D-35-2 · `FollowUp` carries `blockName` and `unitNumber` as flat required
  fields.** _Why:_ lists name the door without a lookup per note; flat keeps notes inside
  `HouseholdHistory` small. Supersedes D-27-7, which handed this to #35 (owner
  confirmed). _Extended by D-117-6:_ also `blockId`, `status`, who listed and who
  removed it.
- **D-35-3 · One `selectFollowUps(db)` builder serves list, get, create, update and the
  household history.** _Why:_ the two copies had already drifted and would drift again
  on the new joins.
- **D-35-4 · A due date is a day, stored as local midnight; a note is overdue once that
  day has passed.** Overdue lists pass `dueBefore` = start of today (strict). _Why:_ "due
  today" is a reminder, not a failure.
- **D-35-5 · Overdue shows an "Overdue" text badge as well as colour.** _Why:_ colour
  alone is inaccessible and hard to see in sunlight.
- **D-35-6 · Outstanding notes are pinned above the timeline, sorted by due day
  (undated last), and appear only there; the timeline holds visits and resolved notes,
  oldest first.** _Why:_ repeating outstanding notes pushed the interest picker below
  the fold at the door. _Refined by D-117-25:_ the pinned notes are two sections, "On
  the follow-up list" and "Waiting for review". _Refined by D-160-8 (#160):_ while older
  visits remain unread, a resolved note older than the oldest visit shown waits with
  them. _Superseded in part by D-275-4 (owner, 2026-11-23):_ in thread mode the timeline
  runs newest first; outstanding notes stay pinned above it.
- **D-35-7 · At the door (recording form) a resolved note is one line with no controls;
  reopen and edit live on the unit screen.** _Why:_ resolved notes accumulate without
  limit. _Extended by D-117-74:_ in a follow-up session an owed note the save will mark
  done offers no Mark done there either.
- **D-35-8 · Re-resolving keeps the first resolution.** `doneAt` and `doneBy` are
  coalesced in the UPDATE. _Why:_ a stale screen or a concurrent tap must not take the
  credit. Refines D-22-4. _Extended by D-117-70:_ Undo never reopens a note marked done
  again since its save.
- **D-35-9 · Follow-up changes are online-only and never queued; screens re-read from
  the server after each change.** A failed re-read keeps the unit already shown. _Why:_
  as D-74-19; the server stamps the resolver. _Refined by D-117-73 (owner):_ a queued
  visit marks a follow-up session's notes done on the server when it lands; no note
  change is itself queued.
- **D-35-10 · A note can be added from the unit header, a visit row (anchored), or right
  after an online save on the recording form (anchored to the saved visit).** _Why:_ the
  server can only anchor to a visit it has stored (D-22-3). _Refined by D-117-26:_ the
  action is worded by role, and only what the household allows is offered.
- **D-35-11 · The admin overdue card sits on `/admin/sessions` and reuses
  `GET /follow-ups?outstanding=true&dueBefore=…&limit=5`; no new endpoint.** Hidden at
  zero; a failed load never blocks the outings list. _Why:_ no dashboard exists; that is
  the admin landing page, and the existing filter answers the question. _Refined by
  D-117-21:_ listed notes only, beside the review count card under New session.
- **D-35-12 · `/follow-ups` defaults to Everyone's outstanding notes; Mine is
  `?view=mine`.** _Why:_ the door matters more than the author (D-22-2 read rule); URL
  state as D-74-55. _Refined by D-117-27:_ the default is everyone's listed notes;
  suggestions are `?view=review`.

## Relies on

D-07-5, D-16-2, D-22-1, D-22-3, D-22-4, D-25-3, D-25-4, D-25-6, D-25-8, D-27-4, D-30-7,
D-30-8, D-32-3, D-74-19, D-74-43, D-74-44, D-74-47, D-74-49, D-74-62, D-74-63.

## Open questions

None.
