# #252 · Fewer round trips per screen

- **Status:** In progress (branch `chore/252-fewer-round-trips`, not yet a PR)
- **Phase:** none (no milestone)
- **Depends on:** #246, #249, #250, #247 (the report)

## Task

The #247 report's recommendations 5 to 8, approved in full by the owner on 2026-11-21.
Production is in sin1 beside Neon, where this saves tens of milliseconds per screen.
Server reads that need nothing from each other run together, an admin page checks the
sign-in once, client screens stop waiting on reads they do not need, and All records'
order gets an index.

## Decisions

### Server reads

- **D-252-1 · Independent reads run together, only after the sign-in check, and never on
  a transaction's client.** `/sessions/active`, `listSessionBlocks`, `listHouseholds`,
  `getHouseholdHistory`, `listHistory`, the attention list and `attachTeams` send their
  independent queries with `Promise.all`. Writes and transactions stay sequential, and
  #249's approval gate is untouched. The query counts are unchanged, but fewer of them
  wait in turn: a unit's history goes from 6 round trips to 2, a block's unit list from 8
  to 4, `/sessions/active` from 5 to 3 (with the sign-in check), and All records and the
  attention list from 4 to 2. _Why:_ in sin1 a query costs about 2 ms of waiting
  (#247). One client runs its queries in turn anyway, and pg 8.23 deprecates queuing them.
  _Trade-off:_ one request can now hold up to five connections, so D-250-6's ten serve
  two or three such requests at once. Later queries wait for a free connection; they do
  not fail. _Research:_ R-258.
- **D-252-2 · The existence checks join the batch, and the 404 still wins.**
  `listHouseholds`' block check and `getHouseholdHistory`'s household check run beside the
  reads they used to gate, and the 404 is thrown once all have answered. _Why:_ a missing
  block or unit has no rows, so the other reads find nothing. _Trade-off:_ a 404 now
  costs those reads too.
- **D-252-3 · `test/round-trips.ts` counts the round trips made one after another.** It
  wraps a pool's `query`. Each query counts one more than the deepest query that had
  already answered when it was sent. `src/server/round-trips.integration.test.ts` pins
  each read's depth. _Why:_ a query count (D-20-3) cannot show whether queries waited for
  each other. It sees only `pool.query`, so it assumes a free connection for every query
  and does not see queries inside a transaction.

### One sign-in check per admin page render

- **D-252-4 · `currentSession` goes through React `cache()` (owner, item 7).** An admin
  page's layout and the page now make one check per server render instead of two. The
  cache lasts one render of one request. It does nothing in Route Handlers and Server
  Actions, so every API request still checks (D-83-1) and revocation stays immediate.
  Refines D-83-6, which stays in force. _Why:_ `requireAdminPage` runs in both the layout
  and the page (D-83-13), and each made its own query. _Research:_ R-254.

### All records

- **D-252-5 · `HistoryLimit`: `/history` takes up to 250 a page.** The default stays 50.
  `/history/mine` and every other list keep the shared `Limit` of 100. _Why:_ only the
  admin export needs large pages, so members' answers stay as they were.
- **D-252-6 · The CSV export reads 250 a page, at most 8 pages, still 2,000 records.**
  Each page's offset is the number of records already received, as D-257-6 does for
  Show more. Refines D-30-3: 20 requests in a row become 8. A server-side export was
  rejected because search runs in the browser and the export applies it (D-30-6).
  _Trade-off:_ 250 records at every field's maximum length measured 4.0 MB (4,009,326
  bytes), about 11% under Vercel's 4.5 MB response limit (see Known limits).
  _Research:_ R-257.
- **D-252-7 · The three filter lists (blocks, sessions, members) are read once per visit
  to the screen.** If any of the three fails, all three are read again on the next filter
  change. #257's filter, paging and generation logic is untouched. _Why:_ they do not
  change with the filters. _Trade-off:_ a block or session created while All records is
  open appears only after the screen is opened again.
- **D-252-8 · `visits_created_id_idx` on `created_at` and `id`, both `DESC NULLS FIRST`,
  in migration 0008, its checksum appended (D-131-9, D-131-10).** _Why:_ a plain `DESC`
  sorts nulls first, and the planner ignores an index with Drizzle's default for
  `.desc()`, NULLS LAST (measured). It is a plain `CREATE INDEX`, as generated, and
  briefly blocks writes to `visits` while it builds. `CONCURRENTLY` cannot run in the
  transaction that drizzle's migrator wraps migrations in. _Research:_ R-256.

### Client request chains

- **D-252-9 · One `/users/me` per page load, shared by the account check and Home's team
  card.** `sharedCurrentUser()` returns the document's latest read, answered or still on
  its way, and makes a new one only when none exists. A failed read is never shared.
  Account's save hands its answer on through `noteSavedUser`, which also notes the role.
  The card takes the shared read on each mount, and reads afresh on every poll and
  Refresh after that. Extends D-85-7 and D-85-8, and keeps D-74-37 (the card's identity
  still comes from `/users/me`). _Why:_ Home read it twice on every load (#247). Sign-in
  and sign-out are full page loads, so a shared read never crosses accounts.
  _Trade-off:_ when Home mounts again after client navigation, the card's first draw can
  show a name or role up to one poll old. The role there is affordance only (D-16-2).
- **D-252-10 · Follow-ups' On the list and Waiting for review ask at once, and only Mine
  waits for the session to name the viewer.** No note is drawn until `useRole` knows the
  viewer (685e35c). The generation moves on a tab tap and before Mine's wait (c9bbd64), so
  the list's late answer is never drawn under Mine. Keeps D-74-51. _Why:_ only Mine's
  query uses the user id. Each note's controls and bylines depend on the viewer: verifier
  r0 saw an admin's Mark done appear 2.4 s after the list and push the cards down.
- **D-252-11 · Only Home's 30 s poll pauses while the tab is hidden.** A tick missed
  while hidden is made up by one read when the tab is seen again. The other polls are
  unchanged. Extends D-24-2, and the team card follows it (D-74-45). _Why:_ nobody sees
  a hidden tab, and the catch-up read keeps D-24-2's promise that blocks attached
  mid-session appear. The owner's item named only Home.
- **D-252-12 · `/households/[id]` is a cached static shell.** `generateStaticParams`
  returns `[]`, and `HouseholdRoute` reads the id with `useParams`. The build marks the
  page `●`. Each unit's page is built on its first request or Link prefetch and kept
  until the next deploy. The proxy's sign-in redirect and its `no-store` still apply
  (D-74-11; checked locally). The root layout reads nothing per request, so no member
  data enters the cached HTML. _Why:_ the page read `params` only for the id, which made
  every visit a function render. _Trade-off:_ the cache grows with every id a signed-in
  user asks for, invalid ids included. Units in view are now prefetched in full.
  _Research:_ R-255.
- **D-252-13 · `/blocks/[id]` stays rendered per request, until the owner decides.**
  _Why:_ it reads `?unit=` for D-117-24's follow-up rows. Read on the client instead, the
  unit would not be in the server's HTML that D-113-1 adopts on mount, so the change
  would reach typing before the page is live (Open questions).
- **D-252-14 · Tests: unit, component and integration tests, and no new E2E spec
  (D-37-6).** _Why:_ the existing suite covers these screens, and the verifier's device
  pass covered the hidden tab, the shared read and the cached unit page on both engines.

## How existing decisions are handled

None is superseded.

| Decision                          | Effect                                                                                     | By               |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| D-83-6                            | Refined (owner): one check per server render; nothing kept across requests or outside one  | D-252-4          |
| D-83-1, D-83-13, D-249-4, D-249-5 | Kept: every API request and admin page checks, layout and page still call, approval as was | D-252-1, D-252-4 |
| D-30-3                            | Refined (owner's scope): 8 pages of 250, still 2,000 records, offset by records received   | D-252-6          |
| D-30-6                            | Kept; the reason a server-side export was rejected                                         | D-252-6          |
| D-20-3                            | Kept: the same fixed query counts, in fewer round trips                                    | D-252-1, D-252-2 |
| D-250-6                           | Kept; its "ten requests at once" now means two or three, since one can hold five           | D-252-1          |
| D-85-7, D-85-8                    | Extended: the gate's one read is shared with the team card; Account's save goes through it | D-252-9          |
| D-74-37, D-16-2                   | Kept: the card reads `/users/me`, sometimes the shared read; its role is affordance        | D-252-9          |
| D-74-51                           | Kept: Mine takes the viewer's id from the token                                            | D-252-10         |
| D-24-2, D-74-45                   | Extended: Home's poll, and so the card's, pauses while hidden; one catch-up read           | D-252-11         |
| D-74-11, D-129-1                  | Kept: the cached unit page still gets `no-store` (local check; Vercel is an owner check)   | D-252-12         |
| D-113-1, D-117-24                 | Kept: `/blocks/[id]` left per request                                                      | D-252-13         |
| D-131-9, D-131-10                 | Followed: generated migration, checksum line appended                                      | D-252-8          |
| #257's first known limit          | Narrowed: a tap on the member's Follow-ups tabs now drops the old tab's late answer        | D-252-10         |

## Evidence

- Verifier r0 to r2 (`c9bbd64`): E2E 195 passed, 7 skipped, on Pixel 5 and WebKit. Each
  change, broken on purpose, failed its own test. With a pg tracer on the standalone
  build, admin pages make 1 sign-in query (2 before), and every API request makes 1,
  repeats included. `/households/[id]` makes 0 queries: MISS, then HIT, with `no-store`.
  The export read 8 requests of 250 for 2,000 unique records. Home made one `/users/me`
  per load, and no `/sessions/active` read in 65 s with the tab hidden.
- Reviewer r2: the sign-in check runs before every parallel read, none runs on a
  transaction's client, the checksum line matches the migration, and #257's logic is
  untouched. This branch merges with `dev` (after #257, PR #265) with no conflicts. The
  tab-tap bump sits before #257's `chooseView`.

## Known limits

- **Cold pool.** The gain needs idle connections. With the pool empty (5 s idle,
  D-250-6), `/sessions/active` took 4 round trips and opened 2 connections, and a new
  connection costs about 12 ms from sin1 against 2 ms a query. So a lone member's first
  read after a pause can be a few milliseconds slower than before (R-258).
- **Export page size.** At 250, an export page has about 11% headroom under Vercel's
  4.5 MB limit. Teams are uncapped, and the API accepts control characters, which JSON
  writes six bytes each: 250 such descriptions would be about 6.7 MB. That export would
  fail with "Could not export those records." The reviewers suggested 200 a page, or
  retrying a failed page in smaller pieces; neither was done (R-257).
- Nothing pins `/households/[id]` as static: its test checks only
  `generateStaticParams()`, and with `force-dynamic` added every test still passes.
- `src/db/client.ts`'s comment "Ten lets ten requests query at once" is now out of date
  (D-252-1). It is code, so the docs step leaves it for the builder.
- #257's first known limit remains where no tap moves the view: Back or Forward on the
  member's Follow-ups, and the admin's tabs, which this branch does not touch.

## Owner checks (not claimed by the PR)

- On Vercel, `/households/<id>` served from the cache still answers
  `Cache-Control: no-store`.

## Relies on

D-16-2, D-20-3, D-24-2, D-30-3, D-30-6, D-37-6, D-74-11, D-74-37, D-74-51, D-83-1, D-83-6,
D-83-13, D-85-7, D-85-8, D-113-1, D-117-24, D-131-9, D-131-10, D-249-4, D-249-5, D-250-6.

## Open questions

- **`/blocks/[id]` (D-252-13).** Should it become a static shell that reads `?unit=` on
  the client, which changes when the unit field is filled on a full load (D-113-1)? Or
  should it stay per request? Until you decide, item 6 is unfinished, and the PR should
  say `Refs #252`, not `Closes #252`.
- **Acceptance.** The issue asks the stage check (#244) to show fewer queries per route.
  That check measures latency, not query counts, and it was not run here (it needs
  Docker). The tracer shows 2 queries down to 1 on admin pages, and the same counts with
  fewer round trips everywhere else. Should `npm run stage:perf -- --db-latency 2` run
  before and after merging, including a cold pool, or is the tracer enough?
