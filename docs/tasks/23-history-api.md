# #23 · History API

- **Status:** Done (PR #61)
- **Phase:** 3 - Core API
- **Depends on:** #20

## Task

Consolidated records for admins; each member's own records.

## Decisions

- **D-23-1 · `/history/mine` takes `memberId` from the session only.** A `memberId`
  parameter is not read. Implements D-10-6.
- **D-23-2 · One query shape for both views**, differing by a `memberId` the caller
  cannot choose. _Why:_ the two cannot drift apart.
- **D-23-3 · Each entry carries visit, household, block and session together.**
- **D-23-4 · Filters:** block, session, member, interest level, religion, date range.
