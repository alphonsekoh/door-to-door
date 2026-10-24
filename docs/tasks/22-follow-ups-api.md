# #22 · Follow-ups API

- **Status:** Done (PR #60)
- **Phase:** 3 - Core API
- **Depends on:** #20

## Task

Create, list, amend, resolve and delete follow-up notes on a household.

## Decisions

- **D-22-1 · Outstanding first: `done_at ASC NULLS FIRST`, then `due_date` nulls last.**
  _Research:_ R-8. _Extended by D-117-5:_ removed notes are listed newest removal first.
- **D-22-2 · Any member can read a household's notes; ~~only the author or an admin can
  edit or resolve~~.** The resolve clause was superseded by D-35-1, and the edit clause
  by D-117-12; the read clause stands, removed notes aside (D-117-4). _Why:_ the next
  person at the door needs to read it.
- **D-22-3 · A note may anchor only to a visit at the same household.**
- **D-22-4 · Resolving records who closed it; a resolved note can be reopened.**
  _Refined by D-117-32:_ while a suggestion waits at the door, an admin's reopen also
  lists it and a member's is `409 follow_up_exists`. Deleting is now the soft
  `POST /follow-ups/{id}/remove` (D-117-4, D-117-34).

## Open questions

None. "Who may resolve a note" was settled by the owner as D-35-1, since superseded by
D-117-12.
