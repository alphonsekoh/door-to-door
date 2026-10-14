# #22 · Follow-ups API

- **Status:** Done (PR #60)
- **Phase:** 3 - Core API
- **Depends on:** #20

## Task

Create, list, amend, resolve and delete follow-up notes on a household.

## Decisions

- **D-22-1 · Outstanding first: `done_at ASC NULLS FIRST`, then `due_date` nulls last.**
  _Research:_ R-8.
- **D-22-2 · Any member can read a household's notes; only the author or an admin can
  edit or resolve.** _Why:_ the next person at the door needs to read it.
- **D-22-3 · A note may anchor only to a visit at the same household.**
- **D-22-4 · Resolving records who closed it; a resolved note can be reopened.**

## Open questions

- Should any member be able to resolve a note they acted on? D-22-2 says admin or author
  only, but 53349a6 already shipped "any member may resolve or reopen". Proposed answer
  D-35-1, awaiting the owner.
