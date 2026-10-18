# #34 · Offline sync test suite

- **Status:** Done (PR #101)
- **Phase:** 6 - PWA & Offline
- **Depends on:** #33, #77

## Task

A dedicated suite for the sync engine: queue operations, idempotent replay, conflict
convergence, partial failure, backoff, quarantine, quota, corruption, and a fuzz test
over random online/offline sequences. Runs in CI without a browser.

## Decisions

Owner decisions are marked **(owner)**.

- **D-34-1 · fast-check for property tests, seeded.** Default seed 34 and 150 runs (20
  for the Postgres property), at most 80 steps, 30 s timeout; `FC_SEED` and `FC_RUNS`
  override. _Why:_ the same sequence every CI run, deeper runs on demand, and a failure
  replays from its printed seed. _Research:_ R-49.
- **D-34-2 · Two layers: a fuzz over a simulated server, and a smaller convergence
  suite on real Postgres.** The fuzz drives the real controller, engine and `sendAs`
  over a memory queue with storage faults. _Why:_ the fuzz must be fast and
  deterministic (about 2 s); the server's rules are only proven against the database.
- **D-34-3 · Fuzz harness, simulated server and PRNG live inside the test file.**
  _Why:_ a helper under `src/lib` would carry the 100% threshold and only get random
  coverage.
- **D-34-4 · The fuzz mocks `@/lib/uuid` with a counter.** _Why:_ uuidv7's random bits
  break ties in send order, so a failure would not replay exactly. _Amended in review:_
  the counter resets to `0x1000` at the start of every run, above the fixed block and
  session ids; it had carried over between runs, so a replay from seed and path did not
  reproduce the same ids.
- **D-34-5 · Integration convergence goes through the real route and `sendBatch`
  (`fetch` stubbed, auth mocked), with a fresh member per test.** _Why:_ exercises
  `withContract` and transport parsing; the route's limiter is module-level and would
  leak between tests.
- **D-34-6 · Bug fixed: a failed controller run backs off instead of re-arming a 0 ms
  timer.** Runs in a row where storage failed wait 5 s, doubling to 5 min, no jitter, not
  shown in the bar; a clean run resets it, and explicit triggers still run at once.
  Refines D-33-19's timing. _Why:_ `schedule()` used records from before the failure, so
  a due one spun the CPU on a closed connection, or re-POSTed a batch until `429` on a
  full disk. D-33-4's jitter spreads load on the server; this wait is for local disk.
- **D-34-7 · "Corruption recovers" means the app keeps working and nothing is lost.**
  A store missing `visits`, a newer version on disk or a closed connection reject per
  call and fall back to the direct save (D-33-10); never a delete, a downgrade or a
  version bump. The provider renders with a queue it cannot read. _Why:_ D-33-2, D-77-2.
- **D-34-8 · Salvage a record whose only damage is its bookkeeping (owner, option B).**
  A stored record failing the check whose `item` (with `sessionId`) and `ownerId` still
  pass the schema reads back as a fresh `queued` record (attempts 0, no error, due now,
  `enqueuedAt` kept when readable) and is sent; a replay the server holds answers
  `unchanged` (D-21-1). Anything else stays `corrupt`: never sent, never deleted, still
  counted by D-33-15. Refines D-33-8. _Why:_ a knock and its owner intact is a real
  visit to deliver; owner scoping (D-33-1) holds because `ownerId` must pass, and no
  outing still means not sent (D-33-25). _Amended in review:_ a sendable record, whole
  or salvaged, also needs `id === item.id`; a mismatch stays `corrupt`. _Why:_ the engine
  matches results by the record's id and the server answers by the item's, so a mismatch
  would come back `missing_result` and be quarantined after a send.
- **D-34-9 · The fuzz pins the queue's invariants after every step.** Nothing unsent
  missing (D-33-2); sent only as its owner (D-33-1, D-77-10); attempts ≤ 10 (D-33-26)
  and never above what the server charged, so whole-request faults charge nothing
  (D-33-27); quarantine only for a poison record, a corrupt row or 10 charged failures;
  corrupt rows (including ones whose item id differs) never sent or deleted, salvageable ones end synced; no timer re-arming
  itself with no wait. Healed, every deliverable record is synced and the server holds
  its newest version. _Why:_ the pins #33 handed on, checked over sequences no one wrote
  by hand.
- **D-34-10 · Scope cut: D-33-25 is not fuzzed at the form.** It stays pinned by the
  form and `record` tests; the fuzz only checks a stored row with no `sessionId` is never
  sent. _Why:_ the form is not part of the engine under test.

## Relies on

D-07-1, D-21-1 to D-21-4, D-33-1, D-33-2, D-33-4, D-33-8 (refined by D-34-8),
D-33-10, D-33-15, D-33-19, D-33-25, D-33-26, D-33-27, D-76-4, D-77-2, D-77-10.

## Known limits

- fake-indexeddb models neither real quota sizes nor eviction; quota is simulated by
  rejecting writes. Safari's per-origin limit and 7-day eviction stay unverified on a
  device, and iOS may report a full disk as `UnknownError` (any rejection is handled the
  same way). _Research:_ R-50.
- Coverage shows every line and branch run, not that each error branch is asserted;
  that is the verifier's break-it pass.

## Open questions

None. Corrupt-record recovery was answered by D-34-8.
