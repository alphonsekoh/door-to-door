# #123 · Rights judged under the write's lock: amends and block detaches

- **Status:** In review (PR #153)
- **Phase:** 7 - Hardening
- **Depends on:** #18, #20, #74, #117

## Task

`PATCH /visits/{id}` checked rights, then wrote the visit and the household in two
statements with no transaction or lock, so an amend by a teammate removed a moment
earlier, or one landing just after the session ended, still committed. `detachBlock`
checked for visits, then deleted with no session lock, so a concurrent visit could land
in a block no longer attached. Found by a security audit.

## Decisions

- **D-123-1 · An amend is one transaction, judged on the rows it locks.**
  `PATCH /visits/{id}` locks the visit's session `FOR KEY SHARE`, then the household
  `FOR UPDATE`, then the visit (D-123-2), then reads the team membership (D-123-3);
  `canAmend` and the member active-session check run on those rows, then both UPDATEs.
  Where to lock is read first, unlocked, since a stored visit never moves (D-74-32).
  Refusal order is unchanged: `404`, `403`, `409 session_not_active`. Extends D-117-45
  to amends; keeps D-20-2 and D-74-17. _Why:_ a removal or an end that commits while
  the amend waits is seen, a failure between the UPDATEs changes nothing, and it is
  sync's order, so the two never deadlock. _Research:_ R-35, R-82.
- **D-123-2 · The amended visit is locked `FOR NO KEY UPDATE`, on PATCH and sync
  (awaiting the owner).** Departs from the issue's `FOR UPDATE` and refines D-74-31's
  lock mode. _Why:_ with `FOR UPDATE`, disbanding a team deadlocks against an amend of
  one of its records (measured: `deadlock detected`, the disband a `500`). With
  `NO KEY UPDATE`, the disband's foreign-key check does not wait, so it is refused
  `409` (D-74-18) and the amend applies. It is the lock the UPDATE takes anyway, and it
  still conflicts with every other amend and writer. _Research:_ R-82, R-124.
- **D-123-3 · `canAmend` reads the team membership `FOR KEY SHARE`.** On both amend
  paths, so a removal from the team waits for an amend that has passed its check.
  Extends D-74-17 and D-74-31. _Why:_ the issue's proposal; otherwise a removal could
  still land between the check and the write.
- **D-123-4 · `detachBlock` runs under `lockSession` (`FOR UPDATE`).** It joins pick
  changes and transitions (D-117-45). Either the detach waits for a visit in flight and
  is refused `block_in_use`, or the visit waits and finds the block gone
  (`409 conflict`; a sync item is `rejected`). Keeps D-18-3 and D-117-37. _Why:_
  D-18-3 held only when nothing ran concurrently; recording already takes the session
  row first.
- **D-123-5 · An amend still marks no follow-up done.** Keeps D-117-65. _Why:_ only a
  new visit marks, and an amend now shares that write's locks, not its effects.
- **D-123-6 · `getVisit`'s not-found branch is an `InternalError` (`firstOrThrow`).**
  PATCH's `404` now comes from the locking read. _Why:_ every caller reads back a visit
  it has just stored or found, and nothing deletes one: `visits.deleted_at` is never
  set, and households, which cascade to visits, are never deleted. _Trade-off:_ a
  path that deletes visits must give `getVisit` its `404` back.
- **D-123-7 · The parked-lock tests hold each order.** Sync's membership-lock test
  parks on the second rights check, the one under the locks, since sync checks once
  before the write too. PATCH against sync has two: the amend holds the household until
  it commits, and an amend queued behind a flush at the household applies after it.
  _Why:_ the first passes whichever row the amend takes first; the second deadlocks if
  it takes the visit before the household.

## Relies on

D-07-2, D-18-3, D-20-2, D-74-17, D-74-18, D-74-31, D-74-32, D-117-9, D-117-37,
D-117-45, D-117-65, D-117-69.

## Open questions

- **Accept D-123-2?** The issue asks for the visit `FOR UPDATE`, and D-74-31 says
  `SELECT ... FOR UPDATE`. Commit `34f549c` already takes `FOR NO KEY UPDATE` on both
  amend paths, so the question is whether to accept that deviation, not whether to fix
  the deadlock. If `FOR UPDATE` stands, a disband during an amend of one of its records
  deadlocks and one of the two fails (a `500`, or a sync item retried), so D-74-18's
  `409` no longer holds under concurrency. If accepted, D-74-31's lock mode is recorded as refined.
