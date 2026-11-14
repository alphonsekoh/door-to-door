# #158 · Team placement locks the people it places

- **Status:** Done (PR #177)
- **Phase:** 7 - Hardening
- **Depends on:** #74, #126, #132

## Task

Forming a team and adding to one judged the placed people's `deactivatedAt` on an
unlocked read before the transaction, so someone deactivated in the same moment could
still be put on a team and made a participant of the session. D-132-6 left this as a gap
(owner, 2026-11-04); this closes it.

## Decisions

- **D-158-1 · Team placement judges the placed people under a lock (owner, #158).**
  **Supersedes D-132-6 for team placement only;** sync and `autoJoin` are unchanged.
  _Why:_ the issue's acceptance criteria; an unlocked read let a deactivated member be
  left on a team and in the participant list.
- **D-158-2 · The placed users' rows are the placement's first lock: `FOR SHARE`, in id
  order.** `assertPlaceable` runs inside the placement transaction on both of its
  callers, `createTeam` and `addTeamMember`. The ids are sorted by `compareUuids` before
  chunking, and each chunk's SELECT is `ORDER BY id`. _Why:_ a deactivation's UPDATE
  waits for `FOR SHARE` but not for the foreign keys' `KEY SHARE` (R-128); id order
  across chunks because `memberIds` is uncapped (D-74-15), so the multi-chunk path stays
  reachable (D-126-3, its 22,000-member test). _Research:_ R-128, R-129, R-161.
- **D-158-3 · Existence and deactivation are judged on the locked rows; the rest follows
  in the same transaction.** A missing person is `404`, a deactivated one `409 conflict`
  "One or more of those people are deactivated." (D-74-26), and nothing is written. The
  already-on-a-team and has-joined checks are plain reads after the lock; a lost race
  there is still caught by the unique indexes (`rethrowTeamConflict`). Refusal order is
  unchanged, and so is the contract: both endpoints already document this `409`. _Why:_
  a judgement made outside the lock was the bug.
- **D-158-4 · A member's own row is one of the locked rows in their `createTeam`.**
  Deactivated while it is in flight, they get the same `409` as anyone placed. Refines
  D-83-11 for `createTeam`, as D-132-7 did for `POST /visits`. `addTeamMember` does not
  place its caller, so D-83-11's window stands there. _Why:_ one predicate, with no
  branch on whether the placed person is the caller.
- **D-158-5 · Lock order: placement is a third `FOR SHARE` taker on users, and no wait
  cycle forms with the writers below.** Extends D-132-5 and D-125-11. Verified orders:
  - Placement: users `FOR SHARE` in id order, then unlocked reads, then team, team-member
    and participant inserts, which take only foreign-key `KEY SHARE` locks and
    unique-index waits.
  - Recording: author `FOR SHARE`, session `FOR KEY SHARE`, household, the visit insert
    (foreign-key `KEY SHARE`), `visit_teammates`, participants, notes.
  - Sync: session `FOR KEY SHARE`, household, visit `FOR NO KEY UPDATE`, team membership
    `FOR KEY SHARE`, participants, notes; no user row.
  - Amend: session `FOR KEY SHARE`, household `FOR UPDATE`, visit `FOR NO KEY UPDATE`,
    team membership `FOR KEY SHARE`.
  - Team changes (rename, disband, remove a member, join): single statements.
  - Deactivation (`updateUser`): users `FOR NO KEY UPDATE` in id order, the UPDATE, then
    deleting `sign_ins`.
  - Follow-up session changes, transitions and block detach: session `FOR UPDATE` only,
    never users or teams.

  _Why no cycle:_ the only lock on a user row that conflicts with `FOR SHARE` is
  `NO KEY UPDATE`, taken by `PATCH /users/{id}`'s `updateUser`, `updateOwnName` and the
  Auth.js adapter's `updateUser` (called only by Auth.js's email provider, which is not
  configured). The first holds only lower-id user rows when it waits, and the other two
  are single statements. The inserts' `KEY SHARE` on users conflicts with none of them.
  Two placements that list each other can still deadlock on their inserts (D-158-8,
  #180). _Research:_ R-124, R-128, R-129.

- **D-158-6 · `compareUuids` (`src/lib/uuid.ts`) lower-cases before comparing.** _Why:_
  the request schema accepts upper-case uuids, and Postgres orders uuids by their bytes,
  which is the order of their lower-case text, not plain string order (R-161).
- **D-158-7 · Parked-lock tests live in
  `src/server/teams/placement-races.integration.test.ts`, with their own copy of the
  harness,** as D-132-8 does for the earlier ones. Each runs for both `createTeam` and
  `addTeamMember`, except the last:
  - A placement that waited on a deactivation is `409` and writes no team, team member
    or participant. It fails if the read is unlocked.
  - A deactivation waits for a placement that locked first, and both land. It fails if
    the lock is `KEY SHARE` or taken after the inserts.
  - A placement queued behind a deactivation at an admin's row does not deadlock. It
    deadlocks without the `ORDER BY`, every run, because of D-158-9.

  _Trade-off:_ the sort across chunks is held by `compareUuids`' unit test and the
  reasoning in D-158-2, not a race; one would need over 10,000 ids.

- **D-158-8 · Known limits, left to #180 (owner, 2026-11-13).** Three gaps predate #158;
  the owner filed them as #180 (P2), not fixed here:
  - Two placements that list each other can deadlock, and one gets a `500`, not a `409`:
    `placeMembers` inserts in caller order, so each multi-row insert can wait on the
    other's row in a unique index.
  - `createTeam`'s session-status read and `addTeamMember`'s `loadTeamFor` stay unlocked
    reads before the transaction.
  - The same id sent in two letter cases counts as two people and is a `404`.

  _Why:_ outside #158's scope; none lets a deactivated person be placed. The deadlock
  was added to this list after review.

- **D-158-9 · The id-order test's placement reads users in storage order (owner,
  2026-11-13).** Refines D-158-7's third test. Its `createTeam` runs on its own
  one-connection pool with `enable_indexscan` and `enable_indexonlyscan` off, ended in
  a `finally`; bitmap scans stay on. _Why:_ the owner ruled the test must catch a missing
  `ORDER BY` every time. An index scan of `users_pkey` returns Admin before Ben with or
  without it, so the test passed without it whenever the planner chose one. A seq or
  bitmap heap scan reads in storage order (Ben `(0,1)`, Admin `(0,3)`), so only the
  `ORDER BY` locks Admin first; bitmap scans read that order too, so they are left on.
  Its own pool keeps the settings off every other test's connection. _Research:_ R-162.

## Relies on

D-74-14, D-74-15, D-74-26, D-83-11, D-117-45, D-123-1 to D-123-4, D-125-10, D-125-11,
D-126-3, D-132-2, D-132-4, D-132-5, D-132-7, D-132-8.

### How existing decisions are handled

| Decision          | Effect                                                                      | By        |
| ----------------- | --------------------------------------------------------------------------- | --------- |
| D-132-6           | Partly superseded (owner): placement is locked; sync and `autoJoin` stay    | D-158-1   |
| D-132-5, D-125-11 | Extended: placement is a third `FOR SHARE` taker on users; no cycle         | D-158-5   |
| D-83-11           | Refined: a member's own `createTeam` is refused once a deactivation lands   | D-158-4   |
| D-126-3           | Corrected: the checks ran before the transaction; now they run inside it    | D-158-2   |
| D-74-26, D-74-15  | Kept: the same `409`, now judged under the lock; `memberIds` stays uncapped | D-158-2/3 |
| D-74-14           | Gap noted (owner): two placements listing each other can deadlock; #180     | D-158-8   |

## Open questions

None.
