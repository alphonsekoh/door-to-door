# #137 · "Open the follow-up list" opens On the list

- **Status:** In progress (branch `fix/137-follow-up-list-tab`)
- **Phase:** 7 - Hardening
- **Depends on:** #117

## Task

Both "Open the follow-up list" links, on New session's Follow-up card and in Add
households when every listed door is already in the session, opened `/admin/follow-ups`
on To review. The admin following them is looking for households to add. Found in the
PR #117 device pass. The PR also carries #138's docs (D-137-4).

## Decisions

- **D-137-1 · Both links ask for On the list in the URL: `/admin/follow-ups?tab=list`.**
  Refines D-117-39. _Why:_ the page already reads `?tab=` (D-117-21), as the overdue
  card's link does, so the page needs no change.
- **D-137-2 · To review stays the page's default.** No `tab`, or anything but exactly
  `list` or `dismissed` (`List` included), opens To review. _Why:_ the issue keeps it,
  the "Follow-up list" link on `/admin/sessions` carries no tab, and D-29-4 reads an
  unknown value as the default.
- **D-137-3 · Component tests only, no E2E.** Each link's `href` is asserted where it is
  rendered, and `AdminFollowUps` is tested for the tab each URL selects. _Why:_ a link
  with a query is no layout or stacking risk; D-37-6 keeps the suite thin.
- **D-137-4 · #138 rides in this PR.** The D-117-65 and D-117-66 rulings, and the index
  statuses of merged work, are docs only. _Why:_ one CI run instead of two; Actions
  minutes are scarce.

## Relies on

D-29-4, D-37-6, D-117-21, D-117-39.

## Open questions

None.
