# #21 · Batch sync endpoint

- **Status:** Done (PR #59)
- **Phase:** 3 - Core API
- **Depends on:** #20

## Task

`POST /visits/sync`: the server half of the offline queue.

## Decisions

- **D-21-1 · Replay is idempotent on the client id** — a repeat is `unchanged`, not a
  new row. Relies on D-07-3.
- **D-21-2 · Last-write-wins on `updatedAt`; an older edit is acknowledged `stale`, not
  rejected.** _Why:_ rejected means retry, and the client would loop forever.
- **D-21-3 · Partial success: per-item results in request order.** Unexpected failures
  reject only that item, with a generic message.
- **D-21-4 · A queue for an ended session is rejected `session_not_active`, never
  discarded.** Reopening lets the same queue through.
- **D-21-5 · Refuses to overwrite another member's visit.**
- **D-21-6 · Rate limited to 30 flushes/minute per member.**
- **D-21-7 · Batches are 1–100 items.**

## Relies on

D-07-1, D-07-3, D-10-5.
