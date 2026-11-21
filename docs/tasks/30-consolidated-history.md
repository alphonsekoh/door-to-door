# #30 · Consolidated history and return-visit list

- **Status:** Done (PR #68)
- **Phase:** 5 - Admin UI
- **Depends on:** #23

## Task

Admin views over the long-term record, and the list of doors that said yes and were
never revisited.

## Decisions

- **D-30-1 · New `GET /households/attention`.** Only the latest visit counts; a household
  with an outstanding follow-up is excluded; oldest first; `minimumInterest` defaults to
  `high`. _Refined by D-117-22:_ a pending suggestion also excludes it, and removed notes
  don't count.
- **D-30-2 · History groups by household, visits oldest first.** _Refined by
  D-251-15:_ visits in one millisecond keep the API's order, reversed.
- **D-30-3 · CSV export walks every page of the filtered set, capped at 20 pages**, and
  says so when capped. _Refined by D-252-6 (#252):_ 8 pages of 250 (`HistoryLimit`,
  D-252-5), still 2,000 records, each page's offset the records already received.
- **D-30-4 · CSV cells starting `= + - @` or tab are prefixed with a quote.** _Why:_
  free text would run as a spreadsheet formula. _Refined by D-129-9:_ also CR, and
  `= + - @` behind leading whitespace, control or format characters. _Refined by
  D-163-1 to D-163-3:_ a `;` or line break inside a value that leads to a sign or tab
  gets its own `'`; a `,` gets none; no `sep=` line.
- **D-30-5 · `to` dates extend to end of day.**
- **D-30-6 · Search stays client-side** (D-29-5); export applies the same search.
  _Extended by D-246-1_ to the attention list, with one matcher (D-246-2).

## Device-pass decisions (same PR)

- **D-30-7 · Layers:** nav `z-40`, sheets `z-50`, dialogs `z-60`; guarded by a test.
- **D-30-8 · Tap targets at least 44px (`min-h-11`).**
