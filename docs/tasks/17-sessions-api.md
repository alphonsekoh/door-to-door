# #17 · Sessions API

- **Status:** Done (PR #55)
- **Phase:** 3 - Core API
- **Depends on:** #12, #16

## Task

List, create, get, start, end, reopen, and the active session with its blocks.

## Decisions

- **D-17-1 · Reopen keeps the original `startedAt` and clears `endedAt`.**
- **D-17-2 · A second active session is `409 session_already_active`** with a message
  saying how to clear it. The database decides (D-07-4); there is no pre-check.
- **D-17-3 · Constraint violations are recognised by walking the error's cause chain.**
  _Research:_ R-7.
- **D-17-4 · `withContract` coerces query strings driven by the schema**, not by the
  value. _Why:_ block names like `"123"` must stay strings.
- **D-17-5 · Block counts join visits through households.**
