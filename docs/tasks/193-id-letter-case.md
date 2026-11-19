# #193 · One id in two letter cases, wherever a request id meets a stored one

- **Status:** Done (PR #204)
- **Phase:** 7 - Hardening
- **Depends on:** #125, #180

## Task

The contract takes a uuid in either letter case (R-161), but some server paths compared
a request's id with a stored or session id as plain text, so a capitalised id that named
the right row got a refusal. The issue named two (`removeTeamMember`, `PATCH
/users/{id}`), both left by #180 as known limits, and asked for a search of the rest.
Server-only: no contract, schema or migration change.

## Decisions

- **D-193-1 · A request id is compared with a stored or session id through `sameUuid`
  at each comparison,** not lower-cased once in the route. Refines D-125-23 from path
  ids to every request id: path, query (`memberId`, `authorId`), body (`blockIds`,
  `householdIds`, `householdId`, `markedByVisit`) and sync items (`blockId`,
  `sessionId`). `sameUuid`'s comment now says "A request's id". _Why:_ ids arrive in
  query strings, bodies and sync items as well as paths, so lower-casing one route's
  path id would leave the rest; and `PATCH /users/{id}`'s self and last-admin rules
  live in the service (D-31-5, and the handler's comment), so its comparisons are made
  there. _Research:_ R-161.
- **D-193-2 · `updateUser` reads all three of its comparisons in either case:** the row
  lookup after the lock, the self rules (D-31-5), and the last-admin rule's "another
  admin" (D-132-1). Each refuses exactly what it refuses by the lower-case id, whether
  the target or the actor is the one in capitals. _Why:_ the issue named two. With only
  the lookup fixed, a capitalised id skipped the self rules and counted the target as
  another admin, so the last active admin could be demoted or deactivated.
- **D-193-3 · A member removes themselves from a team by their id in either case; a
  teammate's id in capitals is still `403`.** Keeps D-74-14's "a member removes only
  themselves". _Why:_ the issue's first path, without widening it.
- **D-193-4 · Six more comparisons are fixed the same way.** Before, each refused a
  capitalised id that named the right row, and wrote nothing:
  - `resolveMemberScope` (GET and POST `/visits`, GET `/follow-ups`): `403` for one's
    own id. It still returns the session's id, so the scope stays lower case (D-16-4).
  - The removed-notes own-id check in GET `/follow-ups` (D-117-5): `403`.
  - Sync's replay location check (D-74-32): an item naming its own block or session was
    refused as "cannot be moved to another unit or session".
  - `insertFollowUp`'s visit-to-household check: `404` "That visit belongs to a
    different household."
  - `assertStillMarkedBy`, the Undo's `markedByVisit` check (D-117-70): `409` though
    that visit still marked it. A `null` guard keeps a note done by hand `409`.
  - The `attachBlocks` and `pickHouseholds` dedupes: one id in two cases counted as two,
    the rows found fell one short, `404`.

  _Why:_ the issue's third criterion; these are the plain-text comparisons the search
  found.

- **D-193-5 · The two session dedupes reuse `distinctUuidsInOrder`,** as D-180-2 chose a
  lower-cased `Set` over pairwise `sameUuid` for a dedupe. Session blocks and picks are
  now inserted in id order, not request order. _Why:_ one form to key on and to count
  the found rows against. The order change cannot be seen: session blocks are read by
  block name, picks by `householdId`, and the revisits list by block then unit.
- **D-193-6 · The remaining comparisons stay as they are.** Comparisons in SQL read the
  value as a `uuid` (R-161). The JavaScript ones compare two database or session ids:
  `canAmend`, `assertPlaceable`, a follow-up's `authorId`, `doneById` and `waitingById`
  against `actor.id`, sync's under-lock re-check of the household and session, and
  `listSignIns`'s `current`. Placement ids are lower-cased first (D-180-1, D-180-2), and
  client visit ids are used only in SQL. _Why:_ the issue's third criterion asks for
  each to be fixed or explained. The builder's search and the reviewers' (`===` and
  `!==`, `find`, `some` and `filter`, `Set` and `Map` keys, text casts in raw SQL) found
  no other.
- **D-193-7 · Every letter-case test uses ids with hex letters,** so the two cases
  differ; the teams test adds Fay and Gus because its fixtures are digits only. Two
  refusals gained tests: a sync replay naming another unit, block or session (D-74-32),
  which nothing tested before, and an Undo after another visit has marked the note done
  again (`409`, D-117-70), so dropping `sameUuid` there fails a test. _Why:_ an id of
  digits upper-cases to itself, and its test would pass without the fix.

## Relies on

D-07-2, D-07-3, D-16-2, D-16-4, D-31-5, D-74-14, D-74-32, D-117-5, D-117-70, D-125-23,
D-132-1, D-132-2, D-180-1, D-180-2.

### How existing decisions are handled

| Decision                           | Effect                                                        | By         |
| ---------------------------------- | ------------------------------------------------------------- | ---------- |
| D-125-23                           | Refined: every request id, at each comparison, not only paths | D-193-1    |
| #180's known limits                | Closed: `removeTeamMember` `403`, `updateUser` `404`          | D-193-2, 3 |
| D-31-5, D-132-1                    | Kept, by an id in either case                                 | D-193-2    |
| D-74-14                            | Kept: a member removes only themselves, in either case        | D-193-3    |
| D-16-4, D-117-5, D-74-32, D-117-70 | Kept, by an id in either case                                 | D-193-4    |
| D-180-2                            | Followed for session blocks and picks                         | D-193-5    |

## Open questions

None.
