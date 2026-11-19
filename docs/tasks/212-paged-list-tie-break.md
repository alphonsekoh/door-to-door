# #212 · Three paged lists settle a timestamp tie by id

- **Status:** In progress (branch `fix/212-paged-list-tie-break`, not yet a PR)
- **Phase:** 7 - Hardening
- **Depends on:** #207

## Task

`listHistory`, `listOwnSessionHistory` and `listSessions` are paged by offset and
ordered by a timestamp alone, so a tie at a page edge could put one row on two pages
and another on none. The CSV export (D-30-3) reads `/history` that way, so the file
could repeat one record and leave out another. These are the lists D-207-8 left for an
issue. Server-only; the contract changes in descriptions only. Built in commit 240f7bd.

## Decisions

The id is the last key in each order, so no order already decided moves; only a tie,
which had no order, gains one (as #207).

- **D-212-1 · `listHistory` orders by `createdAt`, then the visit `id`, both
  descending.** It serves `/history` and `/history/mine` (D-23-2), so both gain it.
  _Why:_ the export reads 100 a page by offset; measured without the id, a tie at a page
  edge repeated one record and dropped another. Same direction as D-160-2.
  _Research:_ R-198, R-211.
- **D-212-2 · `listOwnSessionHistory` orders by the member's last record
  (`max(created_at)`), then `outing_sessions.id`, both descending.** D-27-3 holds. The
  id is a grouped column, so the `GROUP BY` query stays valid (checked on PostgreSQL 17,
  which CI runs). _Why:_ as D-212-1.
- **D-212-3 · `listSessions` orders by `createdAt`, then the session `id`, both
  descending.** _Why:_ as D-212-1.
- **D-212-4 · The contract names the tie-break only where it already stated an order:
  `GET /sessions` and `GET /history/mine/sessions`.** Description only; `generate:api`
  regenerated nothing. `/history` and `/history/mine` state no order, so none was added.
  _Why:_ the issue's scope ("where `openapi.yaml` gives these orders"), worded as for a
  unit's visits.
- **D-212-5 · Tests follow D-207-5: three rows at one instant, ids 2, 3, 1.** Each
  failed with its tie-break removed. The `/history` test also meets criterion 3: it reads
  two pages of three whose edge falls inside the tie and expects all six records once, in
  order. _Why:_ the export's failure is two pages disagreeing, so the test reads two.
- **D-212-6 · The grouped list's test holds for a different reason from D-207-5.** Its
  sort receives rows in the grouping step's order, not the order stored. Without the
  id, the builder got 1, 2, 3 (group key ascending) and the reviewer 1, 3, 2 in psql
  (likely a hash aggregate). Neither is 3, 2, 1, so the test fails either way. A plan
  grouping by session id descending would pass it without the id; none was seen. The
  test's comment ("stored neither in session id order nor its reverse") gives D-207-5's
  reason, which does not fit here (reviewer nit; code not changed).
- **D-212-7 · Sign-in eviction, `listSignIns` and #126's known limit stay out
  (D-207-8).** The callers the reviewer checked (admin sessions, own-history paging,
  `target-session.ts` at `limit=1`, consolidated history and its CSV loop, session
  records, team records) take the server's order as given; none relied on how a tie
  came back. _Why:_ the issue's scope.

## Relies on

D-23-2, D-27-3, D-30-3, D-160-2, D-207-5, D-207-8.

### How existing decisions are handled

| Decision           | Effect                                                         | By               |
| ------------------ | -------------------------------------------------------------- | ---------------- |
| D-207-8            | Done: its three lists fixed; its open question answered (#212) | D-212-1 to 3     |
| D-30-3             | No longer at risk from a tie: every page agrees on one order   | D-212-1          |
| D-27-3             | Kept: by the member's last record; a tie by session id         | D-212-2          |
| D-23-2             | Kept: one query, so `/history/mine` gains the same tie-break   | D-212-1          |
| D-207-5            | Followed, with a different reason for the grouped list         | D-212-5, D-212-6 |
| #126's known limit | Stands (D-207-2)                                               | D-212-7          |

## Known limits

- `/history` and `/history/mine` state no order in the contract, so the export's
  one-order-across-pages has no written promise. A possible spec follow-up, as #207's
  known limit is for other lists.
- Offset paging still shifts if the matched set changes between two page reads (a record
  stored mid-export). D-212 settles ties only, and the export does not keep each record
  once by id.

## Open questions

None.
