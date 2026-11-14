# #180 · Team placement: id order, session lock, one id in two cases

- **Status:** In progress (no PR yet)
- **Phase:** 7 - Hardening
- **Depends on:** #74, #132, #158

## Task

Close the three gaps #158 left in team placement (D-158-8): two members forming teams
that list each other could deadlock and one got a `500`; `createTeam`'s session status
and `addTeamMember`'s team checks were read unlocked before the transaction; and one id
sent in two letter cases counted as two people. Server-only: no contract or schema
change.

## Decisions

- **D-180-1 · Placed ids are put in one order, once.** `distinctUuidsInOrder`
  (`src/lib/uuid.ts`) lower-cases, de-duplicates and sorts them with `compareUuids`
  before the user locks, and the team-member and participant inserts follow that
  order. Refines D-158-2: the sort moved out of `assertPlaceable` to this one call,
  `lockPeople` takes the lock, and `assertPlaceable` judges rows already locked. Its
  empty-list return is gone, since an admin's team of nobody runs no lookup in any
  check. _Why:_ two placements listing the same people now queue at the first one they
  share, and the one-team index refuses the second (`23505`, so `409 conflict`) instead
  of a deadlock (`40P01`, a `500`). Closes D-158-8's first limit and D-74-14's gap.
  _Research:_ R-179, R-161.
- **D-180-2 · One id in two letter cases is one id.** The ids are lower-cased into a
  `Set`, not compared pairwise with `sameUuid` (D-125-23). _Why:_ a dedupe needs one
  form to key on, and lower case is how Postgres writes ids back, so the count, the
  lock order and the inserts all use it. Closes D-158-8's third limit. _Research:_
  R-161.
- **D-180-3 · The session row is the placement's second lock, `FOR KEY SHARE`, and the
  session and team are judged on it.** `createTeam` reads its session locked;
  `addTeamMember` reads its team joined to the session in one statement with no `OF`
  list, which locks both rows. A placement that waited on an end reads it and is
  refused `409 session_not_active`, writing nothing; an end that comes second waits.
  An admin's add is still allowed on an ended session (D-74-14). _Why:_ the issue's
  fix, in D-132-5's order for `POST /visits` (users, then session); `KEY SHARE` is
  what recording takes, so the two never wait on each other there. Closes D-158-8's
  second limit. _Research:_ R-180, R-129.
- **D-180-4 · A member's add also locks their own membership `FOR KEY SHARE`, third,**
  as `canAmend` takes it. _Why:_ their removal, one `DELETE`, then waits for the add,
  or the add finds it gone. A disband locks the team before its members, as the add
  does.
- **D-180-5 · An add that waited on a disband is `404` "No such team.", and one whose
  member caller was removed meanwhile is `403` "You are not on that team.",** not the
  `409` the issue's second criterion names. _Why:_ those are the refusals
  `openapi.yaml` already declares for those states, in D-74-14's order (`404`, `403`,
  then `409`), and a `409` means nothing for a team that no longer exists. Before
  #180, a disband landing between the unlocked read and the insert was a `500` from the
  foreign key (`23503`). Owner to confirm (Open questions).
- **D-180-6 · Lock order, refining D-158-5.** Users `FOR SHARE` in id order; the
  session `FOR KEY SHARE` (an add's statement locks its team, then the session); for a
  member's add, their membership `FOR KEY SHARE`; then the plain reads, the team
  insert, and the team-member and participant inserts in D-180-1's order. No new cycle,
  path by path:
  - Transitions, household changes and `detachBlock` lock the session `FOR UPDATE`
    (`lockSession`) and never a user, team or member row.
  - Recording, sync and amend take the session only `KEY SHARE`. Their one possible
    wait with a placement is on a participant row, and each inserts only its own
    author's.
  - Deactivation (`updateUser`) locks only user rows, as D-158-5 found.
  - `deleteTeam`'s `DELETE` holds nothing before the team row; `removeTeamMember` is
    one `DELETE`.
  - Two placements insert in the same order (D-180-1).

  No path holds the session in a mode that blocks `KEY SHARE` and then waits on a team,
  so the order inside the add's one statement does not matter. _Research:_ R-128,
  R-129, R-180.

- **D-180-7 · Refusal order is unchanged, but a refused placement first locks the
  people it named `FOR SHARE` until it rolls back:** an unknown session or team, an
  ended or draft session, a bad name, a non-member's `403` add. _Why:_ the users are
  the first lock (D-158-2, D-180-6); judging the session before them would mean an
  unlocked read again or a lock out of order. _Trade-off:_ any member can make a
  deactivation or rename of a person wait for one refused request.
- **D-180-8 · The race tests reuse D-158-7's harness, generalised.** `parked` takes any
  held row and wait pattern, `waitingOn` takes a count, and `heldInTheIndex` holds a
  third person's place in the one-team index, so both mutual placements park on it
  before it is let go. New tests: mutual `createTeam`s (one team, one `409`); an end
  waited on, for a create and an add (`409`, nothing written); a disband (`404`) and a
  member's removal (`403`) waited on by an add. D-158-7's "holds the deactivation" test
  now parks at the session lock on both paths. _Why:_ as D-132-8, only a held lock
  proves an order; holding the third person makes the crossing happen every run, with
  no sleep. Each fails without its fix (builder; reviewer reproduced): no sort,
  `40P01`; `createTeam`'s session read unlocked, 2 tests; the add's team-and-session
  read unlocked, 4; the membership read unlocked, 1. _Research:_ R-179.

### Known limits

- Ids are still compared as text outside placement. A member removing themselves by an
  upper-case id is `403` (`removeTeamMember`), and `PATCH /users/{id}` by an
  upper-case id is `404` (`updateUser` finds its row by text). Both refuse and write
  nothing. The reviewer suggested a follow-up issue; none is filed here.

## Relies on

D-74-14, D-74-15, D-74-26, D-83-11, D-117-45, D-123-1 to D-123-4, D-125-11, D-125-23,
D-126-3, D-132-5, D-132-8, D-158-2 to D-158-9.

### How existing decisions are handled

| Decision | Effect                                                                         | By           |
| -------- | ------------------------------------------------------------------------------ | ------------ |
| D-158-2  | Refined: one sort before locks and inserts; `assertPlaceable` judges only      | D-180-1      |
| D-158-5  | Refined: the session (and an add's team and membership) locked after users     | D-180-6      |
| D-158-7  | Refined: the deactivation test parks at the session lock on both paths         | D-180-8      |
| D-158-8  | All three limits closed                                                        | D-180-1 to 4 |
| D-74-14  | Gap closed: mutual placements are one `201` and one `409`; check order kept    | D-180-1/5    |
| D-158-4  | Kept: an add still does not lock its caller's user row; D-83-11's window stays | D-180-4      |

## Open questions

- **D-180-5 (owner to confirm).** The issue asks that an add which waited on a team
  change be refused "with the existing 409". The PR answers `404` after a disband and
  `403` after the caller's removal, the refusals the contract already gives those
  states. A `409` there would break D-74-14's order, where a missing team is `404` and
  a non-member `403`.
