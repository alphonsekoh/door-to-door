# #20 · Households and visits API

- **Status:** Done (PR #58)
- **Phase:** 3 - Core API
- **Depends on:** #12, #16

## Task

Record a visit, amend it, list a block's households, read a unit's timeline.

## Decisions

- **D-20-1 · Recording upserts the household on `(blockId, unitNumber)`.** The request
  carries block and unit, not a household id.
- **D-20-2 · Members amend their own visits while the session is active; an ended
  session is `409 session_not_active` pointing at reopen.** Admins amend anything,
  including history.
- **D-20-3 · `listHouseholds` runs a fixed number of queries regardless of page size.**
  _Why:_ N+1 on a hundred-unit block.
- **D-20-4 · Follow-up author and resolver are joined through aliased `users`.**

## Relies on

D-07-1, D-07-2, D-10-3, D-16-4.
