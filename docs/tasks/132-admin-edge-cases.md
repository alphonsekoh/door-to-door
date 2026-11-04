# #132 · Admin edge cases: the last active admin, and recording for a deactivated member

- **Status:** Done (PR #157)
- **Phase:** 7 - Hardening
- **Depends on:** #31, #83, #117, #123

## Task

Two admins demoting or deactivating each other at the same moment both passed D-31-5,
leaving no active admin. An admin's `POST /visits` with `memberId` checked only that the
member existed, so a visit could be attributed to a deactivated member, and auto-join then
made them a participant. Found by a security audit.

## Decisions

- **D-132-1 · No change may leave the team without an active admin.** Demoting or
  deactivating the last active admin is `409 conflict`, "The team needs at least one
  active admin.", whoever asks. It is judged after the `404` and D-31-5's self refusals,
  which keep their messages. Extends D-31-5. _Why:_ D-31-5 held only in sequence. Over
  HTTP the actor is an active admin who may not change themselves, so only two changes at
  once reach this rule, and its sequential tests call the service.
- **D-132-2 · Judged on row locks, not an advisory lock.** `updateUser` is one
  transaction. Its first statement locks the target and every active admin
  `FOR NO KEY UPDATE`, ordered by id, and the rule reads only those rows. _Why:_ it locks
  what it judges (as D-117-9, D-123-1); `NO KEY UPDATE` never blocks the `KEY SHARE` a
  foreign key takes on a user (as D-123-2); one statement in id order, so two changes
  never lock in opposite orders. Unlike the first admin (D-105-5), the rows exist to be
  locked. _Trade-off:_ conservative. A row the statement waited for is re-checked against
  its filter, but an admin promoted after it began is not counted, so a change may be
  refused that would have passed; a retry passes. _Research:_ R-35, R-82, R-129.
- **D-132-3 · The actor's own rights are not re-judged under the lock (owner,
  2026-11-04).** They stay the per-request check (D-83-1), with D-83-11's window. _Why:_
  the rule protects the team's admin count, whoever makes the change.
- **D-132-4 · `POST /visits` needs an active author, judged under a `FOR SHARE` lock on
  the author's row.** A missing author is still `404` "No such member."; a deactivated
  one is `409 conflict` "That member's account is deactivated.", and nothing is written.
  _Why:_ not `403 account_deactivated`, which the client reads as the caller being
  deactivated (D-85-2); `409 conflict` matches D-74-26. `FOR SHARE` because a
  deactivation's UPDATE waits for it but not for the foreign key's `KEY SHARE`.
  _Consequence:_ a paper record for someone since deactivated needs them restored, the
  record entered, then deactivated again. _Research:_ R-82, R-124, R-128.
- **D-132-5 · The author's row is the first lock of a `POST /visits` write: author
  `FOR SHARE`, then session `FOR KEY SHARE`, household, notes.** Refines D-117-45, where
  the session came first. Sync keeps the session first, and neither sync nor an amend
  (D-123-1) locks a user. Refusal order is unchanged: block `404`, member `404`, member
  `409`, then the session's `409`s. _Why:_ a visit waiting on its author holds nothing
  else. The only user-row locks that conflict with `FOR SHARE` are `updateUser`'s, which
  takes only user rows in id order, and `updateOwnName`'s single UPDATE; neither holds a
  session, household, visit, note or membership. Every other user-row lock is a foreign
  key's `KEY SHARE`, which conflicts with neither. So no wait cycle forms. _Research:_
  R-128, R-129.
- **D-132-6 · Sync, `autoJoin` and team placement are unchanged.** Sync's author is
  always the caller, judged per request, so D-83-11 stands for a batch; `autoJoin`'s
  callers vouch for the author; placement already refuses a deactivated user (D-74-26).
  _Why:_ none of them names another member, and a per-item refusal in sync would fall to
  the queue's default branch and be held until tapped. _Gap (owner, 2026-11-04):_
  placement judges `deactivatedAt` on an unlocked read, so a member deactivated in the
  same moment can still be placed on a team; locking it is #158.
- **D-132-7 · Refines D-83-11 for `POST /visits`.** A member deactivated while their own
  single record is in flight gets the same `409 conflict` instead of a completed write.
  _Why:_ one predicate, with no branch on whether the author is the caller; it is a
  millisecond race, and the next request raises the account screen (D-85-2).
- **D-132-8 · Parked-lock tests hold each order** (`src/server/follow-ups/races.integration.test.ts`).
  A recording that waits for a deactivation is refused and writes nothing. A deactivation
  waits for a recording that took the author first, with no deadlock; that test fails if
  the lock is `KEY SHARE` or taken after the session. Crossed demotions and crossed
  deactivations each let exactly one through. _Why:_ as D-123-7, only a held lock proves
  an order.
- **D-132-9 · `getUser`'s not-found branch stays a `404`, not an `InternalError` as
  D-123-6 made `getVisit`'s (owner, 2026-11-04).**
  `updateUser` no longer reaches it before writing, but `updateOwnName` does, and it keeps
  "Your account no longer exists." for an account deleted by hand after the per-request
  check. A service test in `rename.integration.test.ts` holds it. _Why:_ D-123-6 rests on
  nothing deleting the row, which does not hold for a user with no records.

## Relies on

D-29-3, D-31-5, D-74-13, D-74-26, D-83-1, D-83-11, D-85-2, D-105-3, D-117-9, D-117-45,
D-117-69, D-123-1 to D-123-4, D-123-6, D-123-7.

D-105's premise, "only a hand edit leaves every admin deactivated", was false before this
task, since two admins could deactivate each other at once; D-132-1 makes it true.

## Open questions

None. The owner confirmed D-132-9 and D-132-3, and moved D-132-6's gap to #158.
