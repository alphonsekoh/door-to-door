# #246 · Needs a return visit: filter by block, search by unit, name or contact

- **Status:** In progress (PR #255, merged to `dev`)
- **Phase:** none (no milestone)
- **Depends on:** #30, #117, #163, #207

## Task

The admin list Needs a return visit (`/admin/attention`) had only the Include medium
interest toggle. Admins need to narrow it as on All records: a block filter (the
endpoint's existing `blockId`) and a search. The toggle, the longest-waiting-first order
and paging stay, and every filter combines (owner, 2026-11-21). UI only; no contract,
schema or server change.

## Decisions

### As planned

- **D-246-1 · The search runs on the device over the loaded rows (owner, 2026-11-21,
  plan Q1 (a)).** Nothing is sent, and there is no debounce. The issue's API `q` and
  debounce came from a brief that misread All records, which has neither. Extends D-29-5
  and D-30-6 to this list. _Why:_ it is what All records does, and a `q` on the API
  would put names and numbers in request URLs and the server's logs, against D-129-7 and
  D-163-9.
- **D-246-2 · One matcher, `matchesHouseholdSearch` (`src/lib/households/search.ts`),
  and it matches the contact too (owner).** The unit as typed or without `#` and `-`,
  the name and the contact, trimmed, in any case. It takes
  `Pick<Household, "unitNumber" | "name" | "contact">`. All records'
  `matchesHistorySearch` and Records' `matchesSearch` stay, with their exports and
  tests, as one-line wrappers, and match exactly as before: the moved code is identical.
  _Why:_ admins meet one search, and two identical copies already existed; the `Pick`
  takes an attention row's household and a history entry's alike.
- **D-246-3 · The block and the toggle live in the address
  (`?blockId=…&minimumInterest=medium`) and are checked on read; the search term never
  is.** `parseAttentionFilters` reads the block through `asUuid` and the toggle only as
  `medium`; neither it nor `toAttentionSearch` reads or writes `q`. The toggle was
  component state; it now survives Back from a household and a reload, which the term
  does not (D-129-7's trade-off, Known limits). Extends D-29-4 and D-129-7 to this
  screen. _Why:_ Back from a household keeps the filters, and every admin list follows
  one rule for the address. _Research:_ R-233 (Known limits).
- **D-246-4 · "Show more (N of M)", 50 a page, added to the end, replaces "Showing the N
  longest-waiting of M".** _Why:_ without it, a search on the device could never reach
  past the first 50.
- **D-246-5 · The block picker lists the first 100 blocks (`/blocks?limit=100`), read
  once on mount; if that read fails it offers only "All blocks", with no message.**
  _Why:_ as on All records; a convenience must not take the list down with it.
- **D-246-6 · Clear filters shows with a block or a search set, clears both, and keeps
  the toggle.** _Why:_ the toggle widens the list rather than narrowing it, and one tap
  already undoes it.
- **D-246-7 · "Nothing is waiting." only with no block and no search (the toggle alone
  is neither); otherwise "Nothing here matches those filters."** _Why:_ an empty
  filtered list says nothing about the doors outside it.
- **D-246-8 · Only the newest read lands, failures included.** A filter change reads
  from the first page and keeps the term. A page or failure for filters just left, or a
  Show more overtaken by a reload, sets nothing, and only the newest read ends the busy
  state. The rows on screen stay while new ones load, so the controls stay mounted and
  keep focus. Extends D-28-7 and D-88-3 to this list. _Why:_ a stale page must not
  appear under new filters, nor a late failure swap the new rows for an alert.
- **D-246-9 · Search, block select and toggle stacked full width, then Clear filters, a
  text button; the Added notice keeps its place above the rows; Show more goes under
  them.** _Why:_ at half width a lone select, or the toggle's label, wrapped at large
  text. All records' Clear filters shares a row with Export CSV, which this screen
  lacks.

### Made while building and reviewing

- **D-246-10 · The block and the toggle move the address with
  `history.replaceState(null, "", href)`, not `router.replace` (4490b2c).** Next's patch
  moves `useSearchParams` in a transition, with no page round trip and no history
  entry; only the list is read. The state must be `null`: with Next's own `__NA` state
  the call passes straight through and the screen never hears. All records does the
  same through #245's `useAddressFilters` (D-245-5, merged to `dev` first); ~~Records still
  uses `router.replace` (#257)~~. Extends D-163-6 from the `?q=` strip
  to filter changes, so R-141's reliance on Next internals now sits in a second place.
  _Why:_ `router.replace` waits on an RSC round trip this page has no use for. On a slow
  link the controls showed the filter just left, and offline Next fell back to a page
  load that the worker answered with Offline, taking the screen and the search with it
  (verifier r0). Now a filter changed offline fails in place to the list's alert and
  Try again, as before #246.
  _Research:_ R-140, R-141, R-232. _Superseded in part by D-257-3 (owner, 2026-11-21):_
  this screen moves through `useAddressFilters` too, so the call and its null-state rule
  live only in the hook; the mechanism and the why above stand.
- **D-246-11 · `useSearchTerm` (D-163-5, D-163-7) serves `/admin/attention` too.** An
  old `?q=` fills the box, and the address keeps only the block and the toggle.
  `signInRedirect` already strips `q` on every path (D-163-8), and no request or
  written address carries the term (D-163-9; checked by the reviewer). _Why:_ the same
  old-link guarantee as All records and Records.
- **D-246-12 · Show more waits for any read of the list.** It is disabled and reads
  "Loading…" while a filter change, Add to list's reload or another page is out.
  _Why:_ pressed under a reload, it would ask for the next page of rows about to be
  replaced. _Applied to All records by D-257-5._
- **D-246-13 · The list effect's cleanup bumps the generation
  (`attention-list.tsx:113`), unlike D-234-3. Keep it; do not align it with D-234-3.**
  _Why:_ here the effect re-runs on every filter change, not only on unmount, and defers
  its load a tick (`setTimeout(0)`). Without the bump, a read for the filters just left
  that lands in that tick passes its check and is drawn. D-234-3's screens run that
  cleanup only on unmount, where a bump is unobservable; this is D-74-45's team card's
  case. No test isolates it (Known limits). _Applied to All records and Records by
  D-257-8_, each with a test that isolates it.
- **D-246-14 · Clear filters changes the address only when a block is set.** _Why:_ the
  term is never in the address, so a search alone has nothing to write there, and the
  rows loaded, Show more's pages included, stay.
- **D-246-15 · Try again and Add to list's reload read from the first page, term
  kept.** _Why:_ a failed page replaces the list with its alert and Try again (D-221-2),
  so there are no rows to add a page to; after Add to list the listed door leaves, which
  shifts every offset.

### Scope and tests

- **D-246-16 · No contract, schema or server change.** `GET /households/attention`
  already took `blockId`. The handler still calls `currentUser("admin")` before reading
  anything (D-16-2), and the list rule (D-117-40), the exclusion of open and removed
  notes (D-117-4, D-117-33) and D-207-2's order are untouched. Integration tests pin the
  block with the toggle, its counts, an unknown block (200, empty: a filter, not a
  lookup), a malformed one (400) and a member with a block (403). _Why:_ the endpoint
  already did it.
- **D-246-17 · One E2E spec, `e2e/attention-filters.spec.ts`.** On both engines, a block
  and the toggle make no RSC request for the screen, Back after a client navigation
  restores both, and a filter changed offline keeps the screen with its alert. It
  records no visit: one in the running session broke `auth.spec`'s Admin link lookup.
  _Why:_ D-37-6 allows it. It rests on Next's history patch and the state Next keeps in
  the entry, which Vitest models by hand, and on there being no page round trip; only a
  real browser on the production build sees them. With `show()` handing Next its own
  state, it failed on both engines (verifier r1). _Research:_ R-232.

## How existing decisions are handled

| Decision                  | Effect                                                                      | By       |
| ------------------------- | --------------------------------------------------------------------------- | -------- |
| D-29-5, D-30-6            | Extended: client-side search over the loaded rows on this list              | D-246-1  |
| D-29-4, D-129-7           | Extended: block and toggle in the address, checked; the term never          | D-246-3  |
| D-163-6                   | Extended to this screen's filter changes; All records and Records unchanged | D-246-10 |
| D-163-5, D-163-7          | Extended: `useSearchTerm` serves `/admin/attention`                         | D-246-11 |
| D-163-8, D-163-9          | Kept: `callbackUrl` and every request stay free of `q`                      | D-246-11 |
| D-28-7, D-88-3            | Extended: newest read lands, late failures dropped                          | D-246-8  |
| D-234-3                   | Not followed here, on purpose: the cleanup runs on each filter change       | D-246-13 |
| D-74-45                   | Followed: bump in the cleanup                                               | D-246-13 |
| D-221-2                   | Applies: a failed Show more replaces the list, so no focus is given back    | D-246-15 |
| D-30-1, D-117-40, D-207-2 | Kept: list rule and order unchanged                                         | D-246-16 |
| D-117-4, D-117-33, D-16-2 | Kept: removed notes excluded; admin checked before any read                 | D-246-16 |
| D-37-6                    | Applied: one spec for what jsdom cannot see                                 | D-246-17 |

## Evidence

- Verifier r0 at 1c1f036: FAIL on D-246-10's cause (`router.replace`); everything else
  passed on a Pixel 5, an iPhone 13 (390×844) and an iPhone 15 Pro Max, at the default
  text and 32px. Verifier r1 at 4490b2c: PASS on all three; E2E 191 passed, 7 skipped
  (the usual WebKit ones); offline visits stored once.
- Bites: four each by the builder, verifier r0 and verifier r1. Each break failed tests,
  except removing D-246-13's bump.
- Builder: all gates green, 5215 tests.

## Known limits

- The term is lost on reload and on Back from a household, while the block and toggle
  come back (D-129-7's trade-off). The concern that the toggle, now in the address,
  would inherit `router.replace`'s reload and lose the term (D-163-6, R-140) is closed by
  D-246-10: a filter change makes no page round trip, and the toggle shows pressed
  within a frame (verifier r1).
- The search reaches only the rows loaded, and Show more counts rows loaded, not rows
  shown: "Nothing here matches those filters." can sit above "Show more (50 of 82)". As
  on All records; the wording is the owner's to change (verifier r0, r1).
- A block the picker does not list, from an edited link or past the first 100, reads
  "All blocks" while the list is filtered to it. Clear filters recovers. As on All
  records.
- `asUuid` is looser than the API's `z.uuid()` (R-233). An edited address with a
  well-formed id of no RFC 9562 version or variant passes, the API answers 400, and the
  screen shows the refusal with a Try again that repeats it and no control to clear the
  block; the header's Sessions link leaves. Records' and All records' `teamId` share the
  check.
- While a filter change loads, the rows and Show more's counts are those of the filters
  just left, under controls showing the new ones, and the empty line follows the new
  filters: from an empty block back to All blocks, "Nothing is waiting." shows until
  the read lands (reviewer r0, r1).
- Offset paging over a list that moves: a door listed, suggested or revisited between
  two pages makes Show more skip or repeat one, and a repeat is drawn twice, as rows are
  not kept once by id. D-207-2's tied latest visits can do the same (reviewer r0, r1).
- Add to list's reload drops the pages Show more had loaded; the list is back to its
  first 50, term kept (D-246-15, reviewer r0).
- No test isolates D-246-13: every new read bumps the counter too, so with the
  cleanup's bump removed all 49 component tests passed (verifier r1). A fake-timer test
  could: change the filter, settle the old read before the timer fires, and check its
  page does not land.
- ~~Records still moves its filters through `router.replace`, so it keeps what verifier r0
  saw here: offline, a filter change shows Offline, and on a slow link the controls lag.
  #257 fixes it. All records was fixed by #245 (D-245-5).~~ Fixed by D-257-1.
- ~~Two implementations of the same address move: this screen calls
  `history.replaceState(null, …)` itself, and All records uses #245's
  `useAddressFilters`. #257 should move this screen onto the shared hook.~~ Fixed by
  D-257-3.
- ~~`useSearchTerm`'s comment still calls it "the history and records search term"
  (reviewer r0); it now serves this screen too. Code, not changed by the docs step.~~
  Fixed by #257: "An admin list's search term".

## Owner checks (not claimed by the PR)

On a real iPhone in airplane mode, pick a block on Needs a return visit: the screen
stays and says it could not load the list. Playwright's WebKit offline bypasses the
worker (D-32-18), though after D-246-10 no navigation reaches it.

## Relies on

D-16-2, D-28-7, D-29-4, D-29-5, D-30-1, D-30-6, D-37-6, D-74-45, D-88-3, D-117-4,
D-117-33, D-117-40, D-129-7, D-163-5, D-163-6, D-163-7, D-163-8, D-163-9, D-207-2,
D-221-2.

## Open questions

None. The owner settled the search's place (on the device) and the contact match on
2026-11-21. No conflict: D-246-13 departs from D-234-3 only where D-234-3's reason (a
cleanup that runs only on unmount) does not hold, and D-246-10 extends D-163-6 to a
second use.
