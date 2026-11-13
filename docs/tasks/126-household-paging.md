# #126 · Household list bounded by its page, request bodies by size, recording by rate (with #127: every page of a block)

- **Status:** Done (PR #159)
- **Phase:** 7 - Hardening
- **Depends on:** #20, #21, #74, #113, #118, #120, #121

## Task

#126: `GET /households` loaded every visit of a page's households and grouped them by
spreading, so one household flooded with visits could stall the process, and past 65,535
bind parameters the unit list answered `500`. Bodies were read whole, `offset` had no
maximum and `POST /visits` no rate limit. #127, in the same PR: the block screen read one
page of 100 households, so 100 junk units sorting first hid real units, and their history,
from every member and from the offline copy. Both were found by a security audit.

## Decisions

- **D-126-1 · `listHouseholds` summarises the page in SQL.** The page query selects only
  ids. A second query, by those ids, joins each household laterally to its visit count
  (`crossJoinLateral`) and its latest visit id (`leftJoinLateral`), both scoped to
  `sessionId` when one is given, and returns the rows in unit order. A third reads those
  latest visits, at most 100, and only they go through `attachTeams`. Latest means the
  newest `createdAt`, then the highest `id`; `getHouseholdHistory` now orders by
  `createdAt`, then `id`, so its last visit is the list's latest. Eight queries, six when
  no latest visit is on a team (D-20-3 kept). _Why:_ the visits Node receives no longer
  grow with a household's visits. In the page query, `OFFSET` would have Postgres compute
  the summaries for every row it skips. Drizzle builds the laterals because raw `sql`
  leaves the outer column unqualified (R-7); the rendered SQL qualifies it.
  _Acceptance, as read:_ #126's first criterion means the rows Node receives and the work
  Node does. Postgres still counts a household's visits with an index scan, which grows
  with them. "Bounded by the page" is per household: each latest visit still carries its
  team's whole teammate snapshot, and team size stays D-118-6's accepted exposure (`main`
  loaded teammates for every visit). _Research:_ R-7, R-132, R-133.
- **D-126-2 · Grouping by key pushes and never spreads.** `appendTo`
  (`src/server/db-utils.ts`) builds `attachTeams`' `matesByVisit` and `loadTeams`'
  `byTeam`. `listHouseholds` no longer groups visits at all. _Why:_ spreading into a new
  array for every row is quadratic in the size of the group.
- **D-126-3 · Id lists reach Postgres 10,000 per statement** (`chunked`,
  `selectInChunks` and `MAX_IDS_PER_STATEMENT` in `src/server/db-utils.ts`).
  `attachTeams` chunks its team ids and its visit ids, so each visit's teammates come
  from one query and stay in name order. `createTeam`'s three checks and two inserts run
  per chunk inside the one transaction, and the checks compare totals as before.
  `placeMembers` lost its early return for an empty list, because the loop then does
  nothing. _Why:_ this gets past Postgres's 65,535 bind parameters while `memberIds`
  stays uncapped (D-74-15). Household history passes every visit of a household to
  `attachTeams`. A service test places 22,000 members in one call. _Research:_ R-131.
  _Corrected by D-158-2:_ until #158 the checks ran before the transaction; they now run
  inside it, with the user chunks sorted and locked in id order.
- **D-126-4 · `readJsonBody` refuses a body over its operation's cap with
  `413 content_too_large`.** An all-digits `Content-Length` over the cap is refused before
  reading. Otherwise it counts bytes as it reads, and cancels the stream once past the
  cap, since the header can be absent or wrong. It decodes as `request.text()` does
  (R-134). The cap is 256 KiB, or 1.5 MiB for `syncVisits` (`ContractSpec.maxBodyBytes`).
  Both are constants in `src/server/http/body-limit.ts`, not config keys: memory guards
  derived from the contract, as D-120-3 is. _Why:_ the largest other body the contract
  admits is under a tenth of 256 KiB. A full sync batch at every `maxLength`, in 3-byte
  characters, is 1,309,547 bytes. A batch whose text is mostly characters JSON must
  escape can pass 1.5 MiB; the `syncVisits` `413` text says so, and isolation recovers it
  (D-126-11). _Research:_ R-135.
- **D-126-5 · Inside `withContract`, `413` is judged with the body.** It comes after the
  cross-origin `403` and the path or query `400`, and before `415`, the body's `400` and
  the handler, so before authentication. It adds the `ErrorCode` `content_too_large` and a
  shared `ContentTooLarge` response on the 17 operations with a body; `syncVisits` has its
  own text. Extends D-10-2 and D-121-8. A request with no session is still answered `401`
  by the proxy first, as the spec's new "Request size" section says. _Why:_ it is the
  cheapest point to refuse, and a refusal on the size of a caller's own request tells
  them nothing.
- **D-126-6 · Refines D-120-7: the proxy still cuts bodies at 2 MiB, at least 512 KiB
  above every contract cap.** `next.config.ts` reads the cut from
  `PROXY_BODY_LIMIT_BYTES`, beside the contract caps, and a test holds the margin. _Why:_
  Next drops the whole chunk that crosses its cut (R-130), so a cut body can be shorter
  than 2 MiB. It must still be over 1.5 MiB, so that it is refused `413` rather than
  parsed short. On contract routes, D-120-7's "nothing answers `413`" and its cut to
  invalid JSON, `400` and isolation no longer hold. The cut is still the only bound on
  routes outside `withContract`, which are Auth.js's. _Research:_ R-108, R-130.
- **D-126-7 · Narrows D-118-6's accepted exposure; D-74-15 kept (owner).**
  `CreateTeamRequest.memberIds` stays uncapped, and the issue's `maxItems` is not built.
  The 256 KiB cap bounds one request at about 6,700 ids, with `413` above that. At 2 MB
  (D-120-7) it was about 53k. So zod builds at most that many issues, and one request
  cannot reach the roughly 21,846 ids that one unchunked insert could bind. D-126-3
  covers that if the cap is ever raised. A team still grows without limit through
  `addMember`, one person at a time. _Research:_ R-91, R-131, R-135.
- **D-126-8 · `POST /visits` is rate limited per caller, 30 a minute.** Its
  `recordLimiter` is separate from sync's (D-21-6), which moved unchanged. Both are in
  `src/server/visits/rate-limits.ts`, since a route module exports only its handlers and
  tests must reset them. It is charged after `resolveMemberScope` and `requireUser`,
  before `createVisit`, and keyed on the caller's user id, so an admin recording on a
  member's behalf spends the admin's budget. Once spent, the answer is `429 rate_limited`,
  "Too many visits recorded. Try again shortly." It is a code constant, like D-21-6, and
  not a `config.yaml` key, although the task expected a key for any new setting.
  **Refines D-75-15 (owner, 2026-11-04, option a):** D-75-15 now covers the sign-in
  budgets and clock-skew tolerance, and the per-member write limits, sync's and this one,
  stay code constants. _Why:_ it mirrors D-21-6. A direct save is the queue's fallback,
  so neither budget may starve the other. _Rejected:_ `rateLimit` keys for both write
  limits (option b).
- **D-126-9 · `offset` is at most 10,000 on every list** (the shared `Offset`
  parameter), with `400` above that. The spec's new "Paging" section says so, and
  `MAX_OFFSET` (`src/lib/households/pages.ts`) mirrors it. _Why:_ a conventional bound,
  well past any screen; the deepest read today is the CSV export, at offset 1,900
  (D-30-3). Postgres computes every row it skips (R-132). _Consequence:_ `loadAllUsers`
  (D-74-61), `loadAllFollowUps` (D-117-52) and the "load more" lists of admin follow-ups
  and own history do not stop at the cap. Past 10,100 rows they get `400` instead of
  reading on, which is unrealistic today. _Research:_ R-132.
- **D-126-10 · The block screen reads every page of the block's households**
  (`loadAllHouseholds`, `src/lib/households/pages.ts`), as D-74-61 and D-117-52 read
  theirs. It reads 100 a page and keeps each household once by id (`keepEachOnce`: the
  copy read last, in the place it first came). It stops when `hasMore` is false, when a
  page is empty, or when the next offset passes `MAX_OFFSET`. As built, after verifier
  rounds 0 and 1, it differs from the plan:
  - A failed page ends the read with the pages before it. `loadAllUsers` and
    `loadAllFollowUps` still fail the whole read.
  - `known` is the last whole read, and only it is written to the offline copy
    (`noteBlock`). The pages of reads that failed since are held in `arrived`, shown over
    it and never saved. If a read fails before any whole read has landed, All units says
    that not every unit could be loaded.
  - Each read lands unless a newer one already has. A whole read replaces `known` unless
    a newer whole read has landed, and clears `arrived` and the error only if nothing
    newer has landed. A failed read lands only if it is the newest. So an older whole read
    still lands after a newer one failed.

  It keeps D-113-1 to D-113-10, and makes D-77-3's "full `HouseholdSummary[]`" true for
  blocks over 100 units. _Why:_ one page let 100 new units push real ones, with their
  history, off every block screen and offline copy (#127). Failing the whole read hid
  page 1 when page 2 dropped on first open. When only the newest read could land, no
  read landed during a run of saves on slow 3G.

- **D-126-11 · The queue treats `413` as it treats `400` (D-33-6).** A batch refused for
  its size turns isolation on and charges nothing. A record sent alone and refused `413`
  is quarantined `invalid`. Extends D-33-6, and D-33-27, whose single-item `400` it joins.
  _Why:_ unlike a `415` (D-121-7), the request's content is at fault. One valid record is
  at most about 26 KB, so only a batch can reach the cap. _Research:_ R-135.
- **D-126-12 · One E2E, in D-120-13's describe block:** the production build answers a
  2.5 MB `POST /api/visits/sync` with `413 content_too_large`, not a cut-off `400`. It
  signs in (`adminApi`), because the proxy answers a sessionless API call `401` first.
  _Why:_ only the built server's proxy cuts bodies. With the sync cap raised above 2 MiB,
  the test gets `400`. _Research:_ R-108, R-130.
- **D-126-13 · Scope cut.** These are not built: #127's server-side lookup of a typed
  unit, admin removal or merging of junk households, a per-member cap on new households,
  and paging `GET /households/{id}`, which is a contract change. _Why:_ reading every page
  meets #127's criteria. Paging `GET /households/{id}` is #160 (owner, 2026-11-04).

### How existing decisions are handled

| Decision          | Effect                                                                      | By                |
| ----------------- | --------------------------------------------------------------------------- | ----------------- |
| D-120-7           | Refined: contract routes answer `413`; the cut bounds only Auth.js's routes | D-126-6           |
| D-118-6           | Exposure narrowed: about 6,700 ids a request, `413` above                   | D-126-7           |
| D-74-15           | Kept (owner): `memberIds` uncapped                                          | D-126-7           |
| D-75-15           | Refined (owner): write limits are constants; keys cover sign-in, skew       | D-126-8           |
| D-20-3            | Kept: eight queries, six with no latest visit on a team                     | D-126-1           |
| D-21-6            | Kept; its limiter moved to `rate-limits.ts`                                 | D-126-8           |
| D-10-2, D-121-8   | Extended: `content_too_large` and a shared `413` response                   | D-126-5           |
| D-33-6, D-33-27   | Extended: a `413` counts as a `400`                                         | D-126-11          |
| D-74-61, D-117-52 | Pattern followed; their loaders meet the offset cap past 10,100 rows        | D-126-9, D-126-10 |
| D-77-3            | Now true for blocks over 100 units                                          | D-126-10          |
| D-113-1 to 10     | Kept                                                                        | D-126-10          |

## Known limits

- `GET /households/{id}` still returns every visit, so typing a flooded unit fetches all
  of them. It no longer fails at the bind limit (D-126-3). Paging it is #160.
- `stampVisit` inserts a team's snapshot in one statement, which would pass the bind limit
  at about 32,700 teammates.
- In a block of more than 10,100 units, the later ones are never read. That read still
  counts as whole, so no note shows and the offline copy ends there. The owner left it
  silent (2026-11-04): no real block comes near.
- `listHouseholdsNeedingAttention` still picks the latest visit by `max(created_at)`,
  without D-126-1's tie-break on the id.
- Sync still lets one member create about 3,000 visits a minute (D-21-6 × D-21-7).
- On weak signal, a block of more than 100 units shows All units (0) and no history until
  every page has arrived. With three pages on slow 3G that took 15 s (verifier).
- On slow 3G, a sent unit is missing from All units for 1 to 5 s, until the next read
  lands. `main` has the same gap for one page.
- The alert gives the browser's words ("Failed to fetch", "Load failed"). It stays after
  an older whole read lands, until the next read lands.
- With three reads in flight, an older failed read's pages can sit over a newer whole read
  until the next whole read lands.

## Relies on

D-07-3, D-10-1, D-10-2, D-12-1, D-16-2, D-20-3, D-21-6, D-21-7, D-30-3, D-33-6, D-33-27,
D-74-15, D-74-61, D-77-3, D-113-1 to D-113-10, D-117-51, D-117-52, D-118-5, D-118-6,
D-120-3, D-120-7, D-120-13, D-121-7, D-121-8.

## Open questions

None. The owner chose option (a) for D-126-8, refining D-75-15; left the block screen
silent at the offset cap; and moved paging `GET /households/{id}` to #160 (2026-11-04).
