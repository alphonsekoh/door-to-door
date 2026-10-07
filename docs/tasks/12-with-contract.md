# #12 · withContract() and contract coverage

- **Status:** Done (PR #51)
- **Phase:** 1 - Data & Contract
- **Depends on:** #11

## Task

A wrapper that validates every handler's request and response against the contract, and
a test that every operation has a handler.

## Decisions

- **D-12-1 · Every handler is wrapped in `withContract`, validating request and
  response.** Drift throws in dev/test; in production it is logged and becomes `500`.
  **Invariant.**
- **D-12-2 · Undocumented response fields fail, and only the parsed value is sent.**
  _Why:_ Zod strips unknown keys silently, so the wrapper compares parsed against
  returned. _Research:_ R-6.
- **D-12-3 · Errors are thrown as `ApiError` subclasses, never hand-built.**
  `ConflictError` carries a specific code.
- **D-12-4 · Unimplemented operations are listed in `PENDING_OPERATIONS`, and a test
  fails if a listed one is implemented.** _Why:_ keeps the list shrinking. Empty since #31.
- **D-12-5 · Delete unreachable defensive branches rather than cover them.**
