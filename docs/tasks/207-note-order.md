# #207 · Rows stored at one instant come back in one order

- **Status:** Done (PR #209)
- **Phase:** 7 - Hardening
- **Depends on:** #160

## Task

A unit's history ordered its notes by `created_at` alone, so notes stored at one instant
came back in whatever order the plan gave. #160's "keeps the same notes on every page"
stored both of its notes in one statement, and failed every time on a test database
reused for many runs while passing on a new one. Server-only: no contract, schema or
migration change. Built in commit 1bdd0bd.

## Decisions

In each order changed here the id is the last key, so no order already decided moves;
only a tie, which had no defined order, gains one.

- **D-207-1 · A unit's notes (`listFollowUpsFor`, the history's `followUps`) are ordered
  by `createdAt`, then `id`, both ascending.** As `GET /follow-ups` already is (D-22-1,
  D-117-51); the contract's "oldest first" and D-35-6 hold. _Why:_ `followUps` is whole
  on every page (D-160-1), so two reads must agree, and the plan's order for a tie
  changed with the database's statistics. _Research:_ R-84, R-198.
- **D-207-2 · The attention list orders by the latest visit's `createdAt`, then its
  `id`, both ascending.** D-30-1's oldest first holds. _Why:_ it is paged by offset, so a
  tie at a page edge could repeat or skip a door (R-84). #126's known limit stands: the
  latest visit is still found by `max(created_at)`, so two visits tied for a door's
  latest both match and the door can show twice. That is not a one-line fix.
- **D-207-3 · `byNoteOwedThenResolved` (`list-rule.ts`) ends on `followUps.id`.** It
  orders a household's notes on the revisits list (`listRevisits`) and in a session's
  picks (`listSessionHouseholds`), so on a tie the note a session row names (`pickNote`,
  D-117-54) is the same on every read. D-117-54's owner-set order is otherwise
  unchanged. _Why:_ as D-207-1; one list rule (D-117-40) means one fix serves both.
- **D-207-4 · The revisits list's `latestVisit` is the newest `createdAt`, then the
  highest `id`.** **Follows D-126-1 and D-160-2:** on a tie it is the visit
  `listHouseholds` calls latest and the unit's history puts first. _Why:_ one meaning of
  "latest" across the app; before, a tie picked any of them.
- **D-207-5 · Each new test stores three rows at one instant, the highest id in the
  middle (ids 2, 3, 1),** not two in reverse id order as the task suggested. Four tests:
  the history's notes, the attention list read a door a page, and the revisits list's
  notes and latest visit. Each failed with its tie-break removed. _Why:_ without the id a
  tie came back in the order stored, and reversed after `ANALYZE follow_ups`. With two
  rows one of those plans gives id order, and the test passes with the bug in place;
  with three, neither does. The reviewer saw 2, 3, 1 (notes) and `#08-08`, `#09-09`,
  `#10-10` (attention) in psql without the id. _Research:_ R-198.
- **D-207-6 · #160's test stores its two notes at distinct times, newest first.** _Why:_
  it meant oldest first, not a tie. It fails with the order reversed, and with the order
  dropped under a plan that returns rows as stored. Under a plan that reverses them it
  would pass, so its comment ("only ordering by when each was written lists them oldest
  first") claims more than two rows can prove (reviewer nit, not changed). D-207-5's
  test is the one that catches a lost order under either plan.
- **D-207-7 · The third criterion (passes on a reused test database) holds by
  construction, not by a run on `door_to_door_test_193`,** which the workflow's
  isolation rules kept out of reach. _Why:_ #160's notes no longer tie, and every
  changed order ends on a unique id. The two-note failure did not reproduce on
  `door_to_door_test_207`, as it was or after `ANALYZE` (R-198).
- **D-207-8 · Fixes stay in `src/server/visits` and `src/server/follow-ups`; three
  other lists ordered by a timestamp alone are left for an issue.** `listHistory`
  (`src/server/history/service.ts:123`, `createdAt` descending), `listOwnSessionHistory`
  (`:232`, the member's last record) and `listSessions` (`src/server/sessions/service.ts:78`)
  are offset-paged, so a tie at a page edge repeats or skips a row. `listHistory`
  matters most: the CSV export (D-30-3) reads `/history` 100 rows at a time by offset,
  so a tie across a page edge can leave one record out of the file and put another in
  twice, with no warning. Only seeds and imports make such ties (sync writes each item in
  its own transaction). Each fix is one more key: the visit id or the session id,
  descending for `listHistory` and `listSessions`. Sign-in eviction and `listSignIns`
  (`src/server/auth/sign-ins.ts:79`, `:228`) are safe: at most `MAX_SIGN_INS` are kept,
  so the limit never splits a tie, and a tie only swaps two equally old rows. _Why:_ the
  task's scope; the reviewer found no others under `src/server`. _Done by D-212-1 to
  D-212-3 (#212)._

## Relies on

D-22-1, D-30-1, D-30-3, D-35-6, D-117-40, D-117-51, D-117-54, D-126-1, D-160-1, D-160-2.

### How existing decisions are handled

| Decision                 | Effect                                                     | By      |
| ------------------------ | ---------------------------------------------------------- | ------- |
| D-22-1, D-117-51         | Followed: a unit's notes end on the id too                 | D-207-1 |
| D-35-6, D-160-1          | Kept: oldest first, whole on every page, now one order     | D-207-1 |
| D-30-1                   | Kept: oldest first; a tie by the visit's id                | D-207-2 |
| #126's `max` known limit | Stands: a door with tied latest visits can show twice      | D-207-2 |
| D-117-40, D-117-54       | Kept: one rule, the owner's note order; a tie by id        | D-207-3 |
| D-126-1, D-160-2         | Followed: the revisits list's latest is the same visit     | D-207-4 |
| D-30-3                   | At risk from `listHistory`'s ties; fixed by D-212-1 (#212) | D-207-8 |

## Known limits

- The contract names the id tie-break for `HouseholdSummary.latestVisit` and the
  history's `visits`, not for `RevisitEntry.latestVisit`, the history's `followUps` or
  the attention list. What `openapi.yaml` says is still true; naming it there too is a
  possible spec follow-up.

## Open questions

None. The three lists were filed as #212 (D-207-8).
