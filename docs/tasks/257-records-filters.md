# #257 · Records' filter picks, the address views offline, and Show more's skipped page

- **Status:** In progress (branch `fix/257-records-filters`; PR not yet open)
- **Phase:** none (no milestone)
- **Depends on:** #245, #246

## Task

Records (`/admin/records`) still moved its filters with `router.replace`, so it had the race #245
fixed on All records: a quick second pick dropped the first, a pick read stale until the
server answered, and a pick with no signal left for the Offline page. The owner's scope
(2026-11-21) also moves Needs a return visit onto #245's shared hook, holds All records'
Show more while a first page loads, and checks the single-value tabs and toggles offline.
UI only; no contract, schema or server change.

## Decisions

- **D-257-1 · Records moves its filters through `useAddressFilters` (owner, scope item
  1).** A pick, the unknown-team drop and Clear filters call `chooseFilters`. The fields
  read the held filters, not `useSearchParams`. Supersedes D-245-7 for Records and extends
  D-245-5 and D-163-6 to it. _Why:_ the race of R-140 and D-245-5, which #245's reviewer
  found here too. _Research:_ R-140, R-141.
- **D-257-2 · The four single-value views move too: the admin follow-up tabs, the
  member's Follow-ups tabs, and Me / My team on `/history` and on a session's records
  (owner, scope item 4).** Supersedes the rest of D-245-7. _Why:_ measured offline on the
  production build. `/admin/follow-ups` and `/history/[sessionId]` are dynamic routes, so
  `router.replace` always waited on the server, and offline the Pixel showed the Offline
  page. `/history` and `/follow-ups` are static and stayed on screen while warm, as the
  builder and verifier r0 first recorded. Once Next's client copy of the route was 5
  minutes old, a tap went to the server too: the Pixel showed the Offline page, and
  WebKit ignored the tap (verifier r1, fixed in 560d5c4). _Trade-off:_ R-141's reliance on Next internals
  (D-163-6) now covers seven screens. _Research:_ R-253.
- **D-257-3 · Needs a return visit moves onto the same hook, so the address move has one
  implementation (owner, issue comment).** Supersedes D-246-10 in part: `show()` calls
  `chooseFilters`, and the null-state rule lives only in the hook. D-246-10's mechanism
  and its reasons stand. `useSearchTerm` keeps its own two-step `replaceState` for the
  `?q=` strip (D-163-6). _Why:_ two copies of the same Next-internal call would drift.
- **D-257-4 · Each screen gives the hook its address as the screen writes it.** The admin
  tabs always write `tab=<value>`, and a bare address reads as `tab=review`. The member's
  On the list and Me write nothing. `scopeSearch` replaces `scopeHref`. _Why:_ the hook
  compares strings, so when the router reports the choice back, nothing changes. These
  are the same addresses as before, so D-74-55, D-117-21, D-117-27 and D-137-1 stand.
- **D-257-5 · All records' Show more waits for any read of the list.** It is disabled and
  reads "Loading…" while a pick's first page, a reload or its own page is out (D-246-12
  applied to All records). Refines D-245-6: a further page still takes the current
  generation. _Why:_ tapped under a pick's first page, its page went onto the old list,
  and page 1 then replaced it, so records 101 to 200 never appeared (245's Known limit).
- **D-257-6 · All records asks for the page after the rows loaded, not a count of taps.**
  _Why:_ a tap count was a second way to skip 101 to 200. After Show more, a Try again or
  an amend reload restarted the list from page 1, but the count still asked for 200.
- **D-257-7 · Records draws only its newest read.** Every read starts a generation: a
  pick, the 30 s poll, Try again, and the reloads after an amendment or after recording
  for a member. A late answer, failure or 404 ("no session") draws nothing. Extends
  D-28-7, D-88-3 and D-234-4 to Records. _Why:_ each pick now loads at once, and the poll
  reads on its own, so an older answer can land last. _Trade-off:_ D-234's slow-line limit
  applies. A read slower than 30 s is never drawn, and `apiFetch` has no timeout.
- **D-257-8 · All records' and Records' effect cleanup bumps the generation (D-246-13
  applied), unlike D-234-3.** Each screen has a fake-timer test that isolates the bump.
  _Why:_ as on Needs a return visit, the effect re-runs on every pick and defers its load
  a tick. Without the bump, a read for the filters just left that lands in that tick
  would be drawn.
- **D-257-9 · Scope.** Records does not page (it shows the first 100), so D-257-5 and
  D-257-6 apply to All records only. D-29-4 is kept: filters live in the address and are
  validated on read, and a pick adds no history entry. The date fields' markup and labels
  are untouched (#258). The older Show more gaps on the follow-up lists and team records
  stay (Known limits). _Why:_ the owner's scope.
- **D-257-10 · Tests, and no new E2E spec (D-37-6).** The issue's test holds a pick's
  first page while further pages answer at once. It checks that Show more is disabled,
  then that the next pages ask for offsets 0 and 100 and draw records 1, 101 and 200. Five
  Records and session-records tests now open at a filtered address, so a missing write
  fails them (3111aee). _Why:_ `attention-filters.spec.ts` already drives the shared hook
  through Next's real router, and `e2e/teams.spec.ts:200-215` drives `/history`'s toggle
  and Back.

## How existing decisions are handled

| Decision                             | Effect                                                                      | By               |
| ------------------------------------ | --------------------------------------------------------------------------- | ---------------- |
| D-245-7                              | Superseded (owner's scope): every screen it kept on `router.replace` moved  | D-257-1, D-257-2 |
| D-246-10                             | Superseded in part (owner): the call lives only in the hook; the why stands | D-257-3          |
| D-163-6, D-245-5                     | Extended to Records and the four views; R-141's trade-off with them         | D-257-1, D-257-2 |
| D-29-4, D-129-7                      | Kept: filters in the address, validated on read; the term never written     | D-257-9          |
| D-74-55, D-117-21, D-117-27, D-137-1 | Kept: the same addresses; unknown values read as the default                | D-257-4          |
| D-163-5, D-163-7                     | Kept: `useSearchTerm` unchanged but for its comment                         | D-257-3          |
| D-245-6                              | Refined: Show more waits for any read and pages from the rows loaded        | D-257-5, D-257-6 |
| D-246-12                             | Applied to All records                                                      | D-257-5          |
| D-28-7, D-88-3, D-234-4              | Extended to Records, the poll included                                      | D-257-7          |
| D-234's slow-line limit              | Applies to Records too                                                      | D-257-7          |
| D-246-13                             | Applied to All records and Records, each with a test that isolates it       | D-257-8          |
| D-234-3                              | Not followed on All records and Records, as on Needs a return visit         | D-257-8          |
| D-37-6                               | Applied: no new spec                                                        | D-257-10         |

## Evidence

- Builder: all gates green, 5548 tests. f13313b's message says `/history`'s toggle and the
  member's tabs stay on `router.replace`; 560d5c4 moved them.
- Verifier r0 (f13313b): device pass clean. Show more's busy guard could be deleted with
  every test green, fixed in 3111aee. Verifier r1 (3111aee): the two static-route views
  left the screen offline when stale (D-257-2). Verifier r2 (560d5c4): PASS. E2E 195
  passed and 7 skipped on both phones. On Pixel 5, iPhone 13 and iPhone 15 Pro Max:
  two picks held 1.5 s both stay on Records, All records and Needs a return visit, with
  no RSC request. All 230 records come through Show more, with none skipped or doubled,
  including after an offline pick and Try again. All four views stay on screen offline
  when stale, cold or with prefetch refused.
- Bites (verifier r2): 23 of 24 mutations caught. The one missed is a line older than
  this change (Known limits). The null-state check bites only in Needs a return visit's
  tests, which seed a state; jsdom's is already null. The hook is shared, so one guard
  covers every screen.

## Known limits

- **The follow-up tabs have no cleanup bump (admin and member).** A read for the tab just
  left that lands in the tick before the new tab's read starts is drawn under the new tab
  until that read lands.
- **Show more on the follow-up lists (admin and member) and on team records is not held
  while a reload is out**, so after a reload it can skip or repeat a page. Older than this
  branch; a candidate for its own issue.
- Deleting the Follow-ups tab's reset to Loading leaves every test green. The line is
  older than this change, and it works on the device.
- Offline on Follow-ups, with 3 or more declined suggestions not yet marked Got it, a tab
  tap's failure and Try again sit under the nav or below the fold. The layout is
  unchanged. More taps end there now that a stale tap no longer leaves for Offline (#239's
  kind).
- In Safari (not the installed app), Show more and Try again end flush with the Install
  Door to Door banner. Both are fully visible and take the tap. Older than this change.
- Needs a return visit still has no test that isolates D-246-13.

## Owner checks (not claimed by the PR)

On a real iPhone in airplane mode, more than 5 minutes after opening each screen, tap My
team on History and Mine on Follow-ups. The screen stays and says it could not load.
Playwright's WebKit offline mode bypasses the worker (D-32-18), so only Chromium measured
the worker. On production, pick two filters straight away on Records; both stay.

## Relies on

D-28-7, D-29-4, D-32-18, D-37-6, D-74-55, D-88-3, D-117-21, D-117-27, D-129-7, D-137-1,
D-163-5, D-163-6, D-163-7, D-234-4, D-245-5, D-245-6, D-246-12, D-246-13.

## Open questions

- **Follow-up issues.** Should the two follow-up-list limits (no cleanup bump on the tabs,
  and Show more after a reload) and the Follow-ups alert below the fold get their own
  issues?

No conflict. D-245-7 is superseded under the owner's scope for #257: item 1 for Records,
and item 4's "if they leave the screen, move them". D-246-10 is superseded in part at the
owner's request in the issue comment. D-257-8 departs from D-234-3 only where D-234-3's
reason does not hold, as D-246-13 does.
