# #245 · All records' date fields on iPhone, and its filters without a round trip

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #30, #74, #163

## Task

On an iPhone 15 Pro Max (Safari, 430 × 932) the From and To date inputs on
`/admin/history` (All records) rendered wrong. Reproduced in Safari on an iOS 26.5
simulator: both ran out of their cells, To past the screen's edge, and stood 32px tall
beside 51px selects; the follow-up sheet's date input ran out too. Fixing it showed a
second fault on the same filters, which the PR also fixes: a picked date read blank until
the server answered, and a quick second pick dropped the first. UI only; no contract,
schema or server change.

## Decisions

- **D-245-1 · The shared `field` utility drops a date input's native appearance.**
  `&[type="date"] { appearance: none; }` in `src/app/globals.css`, so one rule covers every
  date input: All records' From and To and the follow-up sheet's Go back by. It covers
  date inputs only; the app has no time, month or week input. The box comes from the
  field's tokens, with no one-off size (D-111-5, D-111-10). _Why:_ iOS Safari draws a
  native date control content-box with a 30px min-height, whatever the page sets. Without
  its appearance, From and To are 194 × 51 like the selects, and the sheet's input fits
  its column. In Chromium and desktop WebKit (Playwright) the box is the same with and
  without the rule (179 × 48, 12px padding, 1px border, 8px radius), and Chromium keeps
  its calendar icon. _Research:_ R-231.
- **D-245-2 · No rule of our own for an empty date's height or its value's alignment.**
  _Why:_ Tailwind's preflight already gives `::-webkit-date-and-time-value` a `1lh`
  min-height and `text-align: inherit`. After D-245-1 the value starts at the left, and an
  empty field keeps its height on iOS, at 16 and 32px. _Research:_ R-231.
- **D-245-3 · The follow-up sheet's date input drops `h-12`, and with it the comment that
  applied D-74-62 to date controls.** It is now `min-h-12 field`. D-74-62 stands for
  selects. _Why:_ without its native look a date input honours `min-height`: 51px on iOS
  (96px at 32px), and 48px (96px) in both Playwright engines. A select still ignores it
  (R-39).
- **D-245-4 · Tests check the cause, not the overflow.** `src/app/date-fields.test.ts`
  scans `src/components` and `src/app` for every `<input type="date">`. It requires the
  `field` class on each and that the three known ids are found. It then compiles
  `globals.css` with Tailwind and requires the date rule inside `field`. The E2E test
  "admin filter selects are at least 44px tall" is renamed "admin filters are at least
  44px tall" and also checks that From and To compute `appearance: none` and are at least
  44px tall. _Why:_ neither Playwright engine draws iOS's control, and jsdom does no
  layout, so an overflow check would pass without the fix. As with
  `filter-transitions.test.ts` (D-111-67), only a check of the source can fail. That is
  not the hollow class check of D-225-6 and D-230-4, which had a layout test available.
  The rule's test and the class test were each shown to fail with their target removed
  (verifier). The suite grows by one existing test, not a new spec (D-37-6).
  _Research:_ R-231.
- **D-245-5 · All records writes its filters through the History API
  (`src/lib/hooks/use-address-filters.ts`), and the screen holds what was picked.**
  `setFilter`, the unknown-team drop and Clear filters call `chooseFilters`. It sets the
  screen's state and then calls Next's patched `history.replaceState(null, "", href)`,
  which moves `useSearchParams` a render later. An address that changes any other way
  (Back, Forward, a link) is taken as it comes. This replaces `router.replace` on
  `/admin/history`, and extends D-163-6's mechanism from the `?q=` strip to every filter.
  D-29-4 is kept: filters still live in the URL and are validated on read, and a pick
  still adds no history entry. Each call follows a press or the teams read, so Next's
  patch is already in place (R-141). _Why:_ `router.replace` moves the address and
  `useSearchParams` only when the server answers (R-140). Until then a picked date read
  blank. A second pick was built on the stale filters and dropped the first: From, then
  To straight away, left only `?to=`. With no signal, it sent the admin to the Offline
  page. _Trade-off:_ it leans on Next 16 internals (R-141), so D-163-6's known limit
  applies: a Next upgrade can break it while Vitest, which models the router by hand,
  stays green. _Research:_ R-140, R-141.
- **D-245-6 · D-28-7's generation counter guards All records' load.** A first page
  (offset 0) starts a new generation and replaces every earlier load. A further page
  (Show more) takes the current generation. A superseded answer draws nothing, whether it
  arrived or failed, which extends D-88-3 to All records. _Why:_ with D-245-5 each pick
  loads at once, so on a slow line an older pick's answer could land last and draw the
  old filters' records under the new fields. The limit is under Known limits.
- **D-245-7 · Only All records changes. `/admin/records` keeps `router.replace`**, as do
  the follow-up list's tabs (admin and member) and the scope toggle on `/history` and a
  session's records. _Why:_ the issue is All records, and the race the verifier found was
  there. The reviewer found that `/admin/records` has the same race (see Open questions).
  The tabs and toggles each write a single value, so a quick second pick cannot drop the
  first.

## How existing decisions are handled

| Decision         | Effect                                                                | By      |
| ---------------- | --------------------------------------------------------------------- | ------- |
| D-111-5, -10     | Kept: one rule in the shared `field` utility, no one-off size         | D-245-1 |
| D-74-62          | Kept for selects; a date input no longer needs `h-12` (noted there)   | D-245-3 |
| D-30-8           | Kept: From and To checked at 44px or more in E2E; Go back by measured | D-245-4 |
| D-37-6, D-111-67 | Kept: one existing E2E test extended; a source check like D-111-67's  | D-245-4 |
| D-225-6, D-230-4 | Kept: hollow there; here a source check is the only one that can fail | D-245-4 |
| D-163-6          | Extended: from the `?q=` strip to every filter on All records         | D-245-5 |
| D-29-4, D-129-7  | Kept: filters in the URL, validated on read; the term never written   | D-245-5 |
| D-163-5, D-163-7 | Kept: an old `?q=` still fills the search and stays out after a pick  | D-245-5 |
| D-28-7           | Applied to All records                                                | D-245-6 |
| D-88-3           | Extended: a superseded load's failure is dropped on All records       | D-245-6 |

## Evidence

- Builder, on Safari in an iOS 26.5 simulator (iPhone 15 Pro Max, 430px). Before: From
  and To were 221 × 32 in 194px cells, and To ran from x 219 to 441 on a 430px screen. The
  sheet's input was 28px wider than its column. After: 194 × 51, the same as the selects.
- Verifier r0, on the same simulator: before and after shots of All records and the sheet
  at 16 and 32px. Verifier r1: 42 views across WebKit at 430 and 390, Chromium on a
  Pixel 5, 16 and 32px, empty and filled, light and dark, and the sheet as admin and as
  member, with 0 faults. From then To with the records request held 1.5s: both stayed,
  with 2 records requests and no RSC request. Back from a door, Forward, refresh, deep
  links, Clear filters, an old `?q=` link and an offline pick all kept the filters. E2E:
  189 passed and 7 skipped on both phones.
- Gate bites (verifier r1): without `setSearch(next)`, 10 tests fail; without both
  generation checks, 3 fail; without the date rule, "drops a date field's native
  appearance" fails.

## Known limits

- **Show more tapped while a pick's first page loads can skip a page.** A further page
  takes the in-flight generation (D-245-6). If the new filter's page 2 lands before its
  page 1, it is appended to the old list. Page 1 then replaces that list while the offset
  stays at 100, so records 101 to 200 never appear and the next Show more asks for 200.
  It needs more than 100 matches, a tap mid-load and answers out of order. The reviewer
  says it was already possible before this branch. Unfixed. Either fix is small: hide
  Show more while a first page loads, or drop a further page that lands before its first
  page.
- **Nothing shows a pick's list is loading.** The fields show the pick at once, but the
  list and its count stay on the old results until the answer lands. Before, the fields
  stayed stale instead.
- **No E2E drives a pick through the real router.** Vitest mocks `next/navigation`.
  `old-search-link.spec.ts` covers the same patched `replaceState` for the `?q=` strip
  only. The verifier drafted a 20-line spec and left it out (D-37-6).
- Every pick reloads the three picker lists along with the records, as before (#252).
- At 32px on iOS, a filled date wraps to two lines inside its cell.
- An empty date field on iOS is a blank box, because iOS shows no placeholder and the
  labels are screen-reader only. This was true before (see Open questions).
- Chromium's calendar icon is near-black in dark mode, as before.
- The iOS evidence comes from a simulator, not a real device. The simulator could not
  tap, so the picker opening is unchecked.

## Owner checks (not claimed by the PR)

On the iPhone: tap From, To and the follow-up sheet's Go back by; the picker opens and the
chosen date shows at once. On production, pick From and then To straight away; both stay.

## Relies on

D-28-7, D-29-4, D-30-8, D-37-6, D-74-62, D-88-3, D-111-5, D-111-10, D-111-67, D-129-7,
D-163-5, D-163-6, D-163-7.

## Open questions

- **Visible labels for the date filters.** "Recorded from" and "Recorded to" are
  `sr-only`. When both are empty, iOS shows two identical blank boxes. This was true
  before #245.
- **A follow-up issue for `/admin/records`.** It still writes its filters with
  `router.replace`, so it has the same blank-until-answered field and the same dropped
  second pick (D-245-7).
- **This PR is wider than the date pickers.** Every filter on All records changes how it
  writes the URL (D-245-5, D-245-6), so the PR body should say so.
- **The Show more limit:** accept it, or fix it in this PR (Known limits).
