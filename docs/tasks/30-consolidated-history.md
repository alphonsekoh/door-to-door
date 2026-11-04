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
- **D-30-2 · History groups by household, visits oldest first.**
- **D-30-3 · CSV export walks every page of the filtered set, capped at 20 pages**, and
  says so when capped.
- **D-30-4 · CSV cells starting `= + - @` or tab are prefixed with a quote.** _Why:_
  free text would run as a spreadsheet formula. _Refined by D-129-9:_ also CR, and
  `= + - @` behind leading whitespace, control or format characters.
- **D-30-5 · `to` dates extend to end of day.**
- **D-30-6 · Search stays client-side** (D-29-5); export applies the same search.

## Device-pass decisions (same PR)

- **D-30-7 · Layers:** nav `z-40`, sheets `z-50`, dialogs `z-60`; guarded by a test.
- **D-30-8 · Tap targets at least 44px (`min-h-11`).**
