# #34 · Offline sync test suite

- **Status:** Open
- **Phase:** 6 - PWA & Offline
- **Depends on:** #33

## Task

A dedicated suite for the sync engine: queue operations, idempotent replay, conflict
convergence, partial failure, backoff, quarantine, quota, corruption, and a fuzz test
over random online/offline sequences. Runs in CI without a browser.

## Decisions

None yet.

## Relies on

D-21-1 to D-21-4.
