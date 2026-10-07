# #33 · IndexedDB write queue and sync engine

- **Status:** Open
- **Phase:** 6 - PWA & Offline
- **Depends on:** #21, #32

## Task

Write to IndexedDB first, then sync; never lose a record to a dead spot.

## Decisions

None yet. The issue specifies: `idb`; flush on `online`, focus and Background Sync;
exponential backoff; poison items quarantined; engine as pure functions over a queue
interface.

## Relies on

D-07-3, D-21-1 to D-21-7, D-25-7, D-26-5 (only changed fields, which keeps
`updatedAt` honest for last-write-wins).

## Inherited

Two acceptance criteria from #26: queued units appear in the unit list and look
distinct.
