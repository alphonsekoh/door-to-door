# #27 · Member own-history screen

- **Status:** Done (PR #65)
- **Phase:** 4 - Member UI
- **Depends on:** #23

## Task

The outings a member worked, one outing's records, and a unit's full timeline.

## Decisions

- **D-27-1 · New `GET /history/mine/sessions`, aggregated server-side.** _Why:_ counting
  from one page of `/history/mine` described the page, not the outing. Every count is
  the member's own.
- **D-27-2 · Timestamp aggregates use `.mapWith(column)`.** _Research:_ R-7.
- **D-27-3 · Sorted by the member's last record, not the session's dates.**
- **D-27-4 · A unit's timeline is not scoped to the caller.** _Why:_ a member's history
  is private; a door's history is shared.
- **D-27-5 · Zero interest outcomes are dropped from the breakdown.**
- **D-27-6 · No date-range filter on own history.** The outing list is the date axis.
- ~~**D-27-7 · Outstanding follow-ups link through without naming the unit.** _Why:_
  `FollowUp` has no unit number; widening it belongs to #35.~~ Superseded by D-35-2.
