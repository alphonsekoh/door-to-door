# #29 · Admin record view for the running outing

- **Status:** Done (PR #67)
- **Phase:** 5 - Admin UI
- **Depends on:** #20, #23

## Task

Every record on the active outing, filterable, amendable, with recording on a member's
behalf.

## Decisions

- **D-29-1 · `CreateVisitRequest.memberId` is admin-only**; a member naming anyone else
  is `403` via `resolveMemberScope`. A nonexistent member is `404`.
- **D-29-2 · Authorship is set once at creation; `PATCH` never changes it.**
- **D-29-3 · `GET /users` implemented here**; deactivated users excluded unless asked
  for, never deleted.
- **D-29-4 · Filters live in the URL and are validated on read.** _Why:_ a URL is
  editable; unknown values are dropped, not forwarded. _Refined by D-129-7:_ except the
  search term, which the screen holds and the URL never carries; an old `?q=` is ignored.
- **D-29-5 · Text search is client-side over the loaded page.** The screen says how
  many it is showing.
- **D-29-6 · One amend sheet for members and admins.**
