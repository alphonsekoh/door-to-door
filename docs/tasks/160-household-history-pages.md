# #160 · Page a unit's history (`GET /households/{id}`)

- **Status:** In progress (PR #190)
- **Phase:** 7 - Hardening
- **Depends on:** #126, #155, #164

## Task

`GET /households/{id}` returned every visit of a unit, so a flooded unit was read, sent
and drawn whole each time it was typed at the door or opened. Page its visits, newest
first, in the shape and under the cap of the other lists (D-126-9), and keep older
visits one tap away on both screens so the interest trajectory stays readable. Moved
here from #126 by the owner (D-126-13).

## Decisions

- **D-160-1 · `GET /households/{id}` pages its visits with the shared `Limit` and
  `Offset` and answers `pagination`.** `household`, `block`, `answered` and `followUps`
  are whole on every page. A bad id, limit or offset is `400`, judged before the handler
  (D-126-5's order); an offset past the last visit answers `200` with no visits.
  Authorization is unchanged (D-27-4). **Supersedes D-126-13's paging clause** (owner:
  #160's last criterion); the rest of that cut stands. Closes #126's first known limit.
  _Why:_ the issue; one paging shape and cap for every list.
- **D-160-2 · Visits are newest first, by `createdAt` then `id`, both descending.**
  **Refines D-126-1's wording:** the history's first visit, not its last, is
  `listHouseholds`' latest. _Why:_ the newest page is the one read first, and the id
  makes the order total, so a page edge inside a run stored at one instant neither
  repeats nor skips a visit.
- **D-160-3 · `visits` has `maxItems: 100`.** _Why:_ `withContract` then checks the bound
  on every answer, not only a test.
- **D-160-4 · New required `answered`:** some visit, on any page, has an interest level
  other than `no_response`. The name line reads it. _Why:_ "Name not known" against
  "Nobody has answered here yet" needs every visit, and a page cannot say it.
- **D-160-5 · Four queries a page, six with a visit on a team, whatever the unit
  holds:** the household and block, the page, one tally (`count`, `bool_or`), the notes.
  Only the page goes through `attachTeams`. **Refines D-126-3's note:** household
  history passes one page, not every visit (its comment in `access.ts` says so). No
  schema change; `visits_household_created_idx` serves the page. _Why:_ what Node
  receives no longer grows with the unit, as D-126-1 reads "bounded".
- **D-160-6 · Offset paging, not a cursor.** The client asks from the offset plus the
  visits received, and keeps each visit once by id: the copy amended last, the first
  page's on a tie. It relies on visits never being removed (`visits.deleted_at` exists,
  nothing sets it) and an amend never changing `createdAt`, so a visit stored between
  reads makes a page repeat one, never skip one. _Why:_ one paging shape. _Rejected:_ a
  keyset `before` cursor, a second shape. A delete path for visits would break this.
- **D-160-7 · The panel owns the older pages.** Both screens read only the first page
  (`historyPath`, `src/lib/households/history-pages.ts`) and key `HouseholdHistoryPanel`
  by household id; the lib also drops pages held for another unit. _Why:_ one place for
  both screens, and two lines in the recording form. No test fails if either key is
  removed: the lib guard alone keeps two units' visits apart (reviewer).
- **D-160-8 · The timeline stays oldest first (D-35-6 kept),** with the control at its
  top, above the oldest visit shown. While older visits remain unread, a resolved note
  older than the oldest visit shown waits with them (**refines D-35-6**). _Why:_ a note
  from years back above this year's visits would hide the gap between them.
- **D-160-9 · An older page, or its failure, lands in `startTransition` (extends
  D-155-2).** Its land-while-typing test does not prove the transition is needed, and
  cannot fail: the panel's state renders only the panel, never the form that holds the
  unit field, so it cannot write the unit back (reviewer). So it is not a D-155-4 guard,
  and the comment above `showEarlier` claims more than this. At the door the keyed panel
  also unmounts before a late page for the old unit lands (verifier r0). _Why:_ kept as
  D-155-2's rule for any answer that can land while a unit is typed; it costs nothing.
- **D-160-10 · A failed older read keeps every visit shown and the control, and adds
  one line under it.** It never blocks recording. _Why:_ as D-35-9's failed re-read and
  D-25-3's failed lookup.
- **D-160-11 · The control shows only while visits remain:** it hides at the total,
  after an empty read, or once the next offset passes `MAX_OFFSET`, silently. _Why:_
  past the cap the contract refuses the read (D-126-9); the owner left the block screen
  silent at its cap too (2026-11-04).
- **D-160-12 · The offline overlay is unchanged.** The panel shows only server visits,
  as before; queued ones show on the unit list (D-33-21) and in the Saved line, neither
  of which reads this operation. _Why:_ queued visits stay visible without this
  operation knowing them; the verifier saw Not sent, and one stored copy, on both phones.
- **D-160-13 · One E2E test added, unlike the plan:** `e2e/record-visit.spec.ts:998`,
  in "without signal", and the order assertion in `e2e/follow-up-session.spec.ts:321`
  flipped to newest first. The test taps the control just above the docked Save with the
  read cut off and checks the failure line is uncovered; a late failure leaves a typed
  note on screen; the retry shows the 21st visit. _Why:_ layout over the docked Save is
  a flow the suite lacked and jsdom cannot see (verifier r0); the issue allows a test
  for such a flow.
- **D-160-14 · 20 visits a page, on both the block screen and the history view (owner,
  2026-11-14, Q1 (a)).** `HISTORY_PAGE_SIZE`. _Why:_ no real unit has 20 visits, so
  only a flooded one pages, and at the door D-35-7 keeps resolved notes to one line.
  _Rejected:_ (b) 5 at the door and 20 on the history view; (c) 50 on both.
- **D-160-15 · "Show earlier visits", "Loading…" while a read is in flight (the control
  disabled), and "Could not load earlier visits." on failure, on both screens (owner,
  2026-11-14, Q2 (a)).** _Why:_ it matches own history's "Show earlier sessions" and
  stays one short line at the door. _Rejected:_ (b) a count, "Show earlier visits (20
  of 312)"; (c) "Show more".
- **D-160-16 · `keepFirstPage`: when the parent reads the first page again, the old
  first page's visits join the older ones held.** After a re-read the panel can show
  more than a page (21 after one new visit), never fewer. _Why:_ a visit stored in
  between pushes the old first page's oldest off the new one, and an older page read
  from an offset counted before that misses it too; the plan dropped it (builder).
- **D-160-17 · The failure line has `role="status"` and is brought into view before
  paint, clear of the docked Save at the door (`scroll-clear-chrome`) and of the nav and
  any floating banner elsewhere (`scroll-clear-nav`, D-164-7, D-164-8),** as the Saved
  line is (D-111-69, D-117-77). Only while the member is still at the control: on
  screen, focus not moved on (`stillAt`, `src/lib/still-at.ts`). _Why:_ drawn under the
  control, it landed under the docked Save on an iPhone 13 and the tap seemed to do
  nothing (verifier r0); scrolled whenever it landed, a late failure pulled the page
  1,500px up from the note being typed (verifier r1).
- **D-160-18 · `timelineNotes` shows every resolved note when no visit is held.** _Why:_
  the page and the tally are separate statements, so a page can come back empty while
  the total says visits remain, and there is no visit to measure from.
- **D-160-19 · The history view's generation-guard test tells the newer read by a name
  learned since,** not by an empty visit list. _Why:_ visits are never removed, and
  D-160-16 keeps a re-read page's visits, so "no visits" no longer marks which read
  landed.

### How existing decisions are handled

| Decision           | Effect                                                                  | By                |
| ------------------ | ----------------------------------------------------------------------- | ----------------- |
| D-126-13           | Paging clause superseded; the rest of the cut stands                    | D-160-1           |
| D-126-1            | Wording refined: the history's first visit is the list's latest         | D-160-2           |
| D-126-3            | Note refined: household history passes one page to `attachTeams`        | D-160-5           |
| D-126-9            | Followed: shared `Limit`, `Offset` and cap                              | D-160-1, D-160-11 |
| D-35-6             | Kept: oldest first. Refined: old resolved notes wait with unread visits | D-160-8, D-160-18 |
| D-155-2            | Extended: older pages land in a transition, not proven needed           | D-160-9           |
| D-27-4             | Kept: any signed-in account reads any unit                              | D-160-1           |
| D-33-21            | Kept: queued visits show on the unit list and in the Saved line         | D-160-12          |
| D-35-9, D-25-3     | Pattern followed: a failed read keeps what is shown                     | D-160-10          |
| D-111-69, D-117-77 | Pattern followed for the failure line                                   | D-160-17          |
| D-164-7, D-164-8   | `scroll-clear-nav` used away from the door                              | D-160-17          |

## Known limits

- Past offset 10,000 (about 10,020 visits) the oldest are never shown, and the control
  hides without a word (D-126-9, D-160-11).
- Each page's tally still reads every visit row of the unit (`count`, `bool_or`): the
  work Postgres does grows with the unit, as D-126-1 accepted. Node receives one row.
- `followUps` is still whole on every page; resolved listed notes grow only by admin
  action.
- Once every visit is shown, a re-read that brings a new visit brings "Show earlier
  visits" back once, and its tap reads only a visit already shown (reviewer).
- More than a page of visits stored at one unit between two first-page re-reads, after
  older pages were opened, leaves a gap until the panel remounts: `holdVisits` keeps the
  old `next`, so the visits between the new first page and the kept old one are never
  read. Example: first page 100..81, older read to 60, then 101..125 stored; 105..101 are
  never shown. Only a flood reaches it. Possible fix: reset `next` when the new first
  page shares no id with the visits held, or drop `earlier` (reviewer r2).
- A visit committed late, with a `created_at` older than visits already read, appears
  with the next read of the first page.
- Deploy skew while the new worker waits: a tab on the old bundle gets the newest 50,
  newest first. Its "Last visit by" names the oldest visit on that page, and older
  visits are out of reach, until it updates (verifier r0).
- Focus falls to `<body>` when the last page loads and the control goes (verifier).
- iPhone (WebKit) only: an older page that lands late while a note is typed pushes the
  focused Notes off the screen (408 to 1,768px on a 664px screen); the next keystroke
  scrolls back and nothing is lost. A late failure moves it 20px, or 130px at 32px on
  320px, under the docked Save. The Pixel 5 holds through scroll anchoring. Whether a
  real iPhone anchors at all is unconfirmed (verifier r2). Accepted as a known limit
  (owner, 2026-11-15); the verifier's suggested fix, a measured `scrollBy` when
  `stillAt` is false, is not built.
- No route test pins `hasMore` on an exactly full last page; the UI reads `next < total`
  instead (verifier).

## Relies on

D-07-2, D-07-3, D-10-1, D-12-1, D-16-2, D-20-3, D-25-3, D-27-4, D-33-21, D-35-6, D-35-7,
D-35-9, D-111-5, D-111-69, D-117-77, D-126-1, D-126-5, D-126-9, D-155-2, D-155-4,
D-164-7, D-164-8.

## Open questions

None. The owner answered the planner's two questions on 2026-11-14 (D-160-14, D-160-15),
and on 2026-11-15 accepted verifier r2's should-fix (a late older page pushing the note
being typed off an iPhone's screen) as a known limit (Known limits).
