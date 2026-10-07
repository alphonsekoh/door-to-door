# #18 · Session-blocks API

- **Status:** Done (PR #57)
- **Phase:** 3 - Core API
- **Depends on:** #17, #19

## Task

List a session's blocks with progress, attach blocks, detach unworked ones.

## Decisions

- **D-18-1 · Blocks may be attached to an active session.** Members see them on refresh.
- **D-18-2 · Attach is idempotent and all-or-nothing.** An unknown block rejects the
  whole request.
- **D-18-3 · Detaching a block with visits in this session is `409 block_in_use`.**
  Visits from other sessions do not count.
- **D-18-4 · Listing an unknown session is `404`, not an empty list.**
