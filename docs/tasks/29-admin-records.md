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
- ~~**D-29-3 · `GET /users` implemented here**; deactivated users excluded unless asked
  for, never deleted.~~ _Superseded in part by D-279-11 and D-279-12: an account is erased 12 months after deactivation, or on request; `GET /users` never lists an erased one. `GET /users` itself stands._
- **D-29-4 · Filters live in the URL and are validated on read.** _Why:_ a URL is
  editable; unknown values are dropped, not forwarded. _Refined by D-129-7:_ except the
  search term, which the screen holds and the URL never carries; ~~an old `?q=` is
  ignored~~. _Refined by D-163-5:_ an old `?q=` fills the search and leaves the address
  on load, which keeps only the recognised filters. _Extended by D-246-3_ to Needs a
  return visit's block and toggle.
- **D-29-5 · Text search is client-side over the loaded page.** The screen says how
  many it is showing.
- **D-29-6 · One amend sheet for members and admins.**
