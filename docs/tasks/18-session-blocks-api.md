# #18 · Session-blocks API

- **Status:** Done (PR #57)
- **Phase:** 3 - Core API
- **Depends on:** #17, #19

## Task

List a session's blocks with progress, attach blocks, detach unworked ones.

## Decisions

- **D-18-1 · Blocks may be attached to an active session.** Members see them on refresh.
- **D-18-2 · Attach is idempotent and all-or-nothing.** An unknown block rejects the
  whole request. _D-18-1 and D-18-2 refined by D-117-37:_ regular sessions only; a
  follow-up session's blocks follow its picked households, and attaching or detaching
  one by hand is `409 conflict`.
- **D-18-3 · Detaching a block with visits in this session is `409 block_in_use`.**
  Visits from other sessions do not count. _Extended by D-117-42:_ removing a follow-up
  session's last pick in such a block is refused the same way. _Extended by D-123-4:_
  judged under the session row lock, so it holds against a visit in flight.
- **D-18-4 · Listing an unknown session is `404`, not an empty list.**
