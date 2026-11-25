# #251 · Sync a batch in a fixed number of round trips

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #21, #74, #117, #123, #247

## Task

`syncVisits` gave each item its own transaction, about 13 round trips a record (17 with a
teammate), and the client sent up to 100 records against a 20 s timeout. In iad1 a
backlog of 7 timed out; in sin1 a full batch was 9 to 13 s (#247, recommendation 3,
approved by the owner on 2026-11-21). This makes the cost of a batch of new records or
replays fixed, keeps every sync rule exactly, and lowers the client's batch size.

## Decisions

- **D-251-1 · No contract change.** `maxItems` stays 100 (D-21-7), and the per-item
  results, statuses and codes stay the same. _Why:_ installed clients still send up to
  100, and the queue relies on per-item results (D-33-16).
- **D-251-2 · What judging needs is read once per batch, then each item is judged in
  request order, in the old check order.** _Refined by D-279-7: a fourth read, the erased places, runs in parallel with the blocks read._ There are three reads: blocks, stored visits
  with their household, and sessions (those named, those of the stored visits, and the
  active one). Each is keyed by the lower-cased id (D-193-1). The order stays: block
  `404`, `canAmend`, move, stale/unchanged, the future bound, session `404`/`409`, then
  the lower bound (D-74-34, D-76-6). The unlocked `canAmend` pre-check still runs for
  each stored item. _Why:_ a batch's ids are distinct (D-251-10), so no item's write
  changes what another is judged on, and the race tests park on that pre-check.
- **D-251-3 · Consecutive new records are a run, written in one transaction.** The run
  locks the session `FOR KEY SHARE`. Under that lock it judges every record's session,
  block and list before it writes anything (`refuseUnderLock`), so each refusal stays
  with its own record. Then a fixed set of statements writes the households, the team,
  the visits, the teammate stamp, the auto-join and the marking. A replay or a refusal
  does not break a run; an amend does. A single new record is a run of one. _Why:_ the
  number of round trips stays the same for any number of records (R-249). Refines
  D-74-31 and D-117-45: the session lock and the under-lock judgement happen once per
  run, not once per item.
- **D-251-4 · A run that fails for any reason rolls back, and its records go again one
  at a time on the per-record path** (`persist`, with its team retry). Reasons include
  fewer rows coming back than were sent (an id stored meanwhile), a disbanded team, a
  deadlock or a lost connection. _Why:_ batching is an optimisation and must never be a
  new way to fail; D-21-3, D-74-31 and D-74-32 hold exactly. Refines D-74-29: the run
  reads the team once, and each record's fallback can read it twice more.
- **D-251-5 · An amend keeps its one-record transaction**, in request order between
  runs (D-123-1 to D-123-3). It costs about 9 round trips, so a batch of amends still
  grows with its length. _Why:_ amends are rare in a queue, and it is the most
  race-tested path.
- **D-251-6 · A run's household upsert has one row per unit and locks every household
  `FOR UPDATE`, in (block, unit) order.** Identity is folded in request order: a later
  known value wins and a blank never erases (D-07-1, D-119-7). `updated_at` moves only
  where something was learnt. The SET always names `unit_number`. _Why:_ one statement
  cannot touch a row twice, and it takes one lock mode for every row (R-246). The mode
  is `upsertHousehold`'s for a record that learns nothing. It is stronger than that
  function's `NO KEY UPDATE` for a record that learns something, which adds waiting but
  no cycle: every note writer takes the household first (D-117-9), and pick changes
  serialise on the session row (D-117-45). Refines D-158-5's Sync line.
- **D-251-7 · A run's visits get `created_at` = the transaction's `now()` plus one
  microsecond per record, in request order.** _Why:_ history, the latest visit and
  revisits order by `created_at`. In one statement every row would get one time, and
  the ids' random tails would order them (R-247). This makes D-207-8's note "(sync writes
  each item in its own transaction)" out of date. Runs share a transaction, but their
  rows are a microsecond apart, so they still do not tie.
- **D-251-8 · Marking credits each household's owed notes to the first new record
  there, in request order**, by its author and at server time. Keeps D-117-65 to
  D-117-69. _Why:_ recording one at a time gave the same result: by the second record,
  the first had marked them all.
- **D-251-9 · Answers are read once, after every write. If a shared read fails, every
  item it serves is rejected `internal_error`.** If the batch read fails, every item in
  the batch is rejected. If the answer read fails, every written or answered item is
  rejected, and what was written stays written, so a resend answers `unchanged`
  (D-21-1). A row missing from the answers rejects only its own item. Each rejection is
  logged through the throttled log (D-87-7). Refines D-21-3: the failure belongs to
  every item that read serves, not to one item. _Why:_ the client treats an answer where
  every item is `internal_error` as a server failure and charges no record (D-33-27,
  D-87-2).
- **D-251-10 · A batch that names one visit twice, in either letter case, runs as
  batches of one through the same path.** That way the second copy is judged on what the
  first stored. _Why:_ the queue is keyed by id, so this is rare, and it keeps the
  one-at-a-time behaviour exactly.
- **D-251-11 · A run's fallback is not logged.** _Why:_ a race is not an error. The
  per-record path logs whatever still fails, and the round-trip tests pin the fast path.
- **D-251-12 · The client sends 25 records a batch (`BATCH_SIZE`); the contract still
  accepts 100.** _Why:_ the worst batch is 25 amends on the per-record path, 232 round
  trips. That is about 0.5 s at 2 ms a round trip, and about 2.4 s at #247's roughly
  10 ms a statement in sin1. A failed run's fallback is about 267 round trips, 0.6 to
  2.7 s. Every case is at least 4× under the 20 s `SEND_TIMEOUT_MS` (R-249), and a
  100-record backlog is 4 sends. Trade-off: D-21-6 allows 30 sends a minute, so one
  member's flush now tops out at 750 records a minute (it was 3,000). A longer backlog
  reaches a `429` and waits 60 s (D-33-17). No batch size makes a far region fit: in
  iad1 even a run of new records is about 4 s.
- **D-251-13 · The block screen still reads every page again after a sync.** _Why:_
  reading only what changed would need a households filter, or rebuilding
  `HouseholdSummary` on the phone (counts, latest visit, owed notes). A block of up to
  100 units is one request (about 80 ms in sin1, #247), and the record just sent is
  nearly always on the open block. The issue's fourth bullet ("if that is simple") is
  left undone.
- **D-251-14 · `POST /visits` and the single-row helpers keep their behaviour and lock
  modes. The batch versions sit beside them and use the same predicates.** The batch
  versions are `upsertHouseholds`, `getVisits`, `stampVisits`, `unitsOffRevisitList`,
  `markDoneByVisits` and `notesMarkedDoneByVisits`. They share `knownFieldsOnly`,
  `onRevisitList`, `offRevisitList` and `placeKey`, which lives in `list-rule.ts`.
  _Why:_ this keeps D-132-4 and D-132-5, and keeps one list rule (D-117-40).
- **D-251-15 · On the phone, visits in the same millisecond keep the server's order
  instead of being sorted by id.** The API's times carry only milliseconds, so a run's
  records tie on the phone (R-247):
  - `holdVisits` keeps tied visits in the order they arrived.
  - `keepFirstPage` holds a re-read first page above the older pages.
  - `groupByHousehold` reverses a door's newest-first visits before its stable
    oldest-first sort (R-248).

  The server's order and its id tie-break are unchanged (D-160-2). _Why:_ the 21-visit
  timeline E2E and All records showed a batch's knocks out of order (verifier r0). This
  refines how the client mirrors D-160-2 and D-160-16, and keeps D-30-2 and D-160-6.

### Departures from the plan (builder)

- `assertMayLand` is deleted. `persist` judges under the lock through `refuseUnderLock`,
  as a run of one, so the under-lock refusals are written in one place. A single new
  record goes through `persistRun` as a run of one; `persist` serves amends and the
  fallback. As before, the list check makes no query for an amend.
- D-251-10 runs repeated ids through `syncBatch`, one item per batch, not through a
  separate `applyItem`.
- A run's household `updated_at` comes from the database's `now()`, not the app clock
  that `upsertHousehold` uses. Nothing reads a household's `updated_at`.
- Replaying one record costs 7 round trips, one more than before, because the sessions
  read is now always made. New records cost 17, or 19 in a follow-up session (R-249).
- Acceptance criterion 2: the two server-convergence tests now assert `BATCH_SIZE` and
  `150 - BATCH_SIZE` instead of 100 and 50. What they check is unchanged.
- A new `sync-races` test: a synced amend whose session ends while it waits is refused
  `session_not_active` and changes nothing.

## How existing decisions are handled

| Decision                   | Effect                                                                             | By                |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| D-21-3                     | Refined: a failed batch or answer read rejects every item it serves                | D-251-9           |
| D-21-6                     | Limit unchanged; at 25 a send it caps a flush at 750 records a minute (was 3,000)  | D-251-12          |
| D-21-7                     | Kept: the contract accepts 100; the client sends 25                                | D-251-1, D-251-12 |
| D-74-29                    | Refined: each record's fallback can re-read the team twice more                    | D-251-4           |
| D-74-31, D-117-45          | Refined: the session lock and the under-lock judgement are per run, not per item   | D-251-3           |
| D-158-5 (Sync line)        | Refined: households `FOR UPDATE`, several per transaction, in (block, unit) order  | D-251-6           |
| D-207-8                    | Note out of date: runs share a transaction, but rows a microsecond apart don't tie | D-251-7           |
| D-160-2, D-160-16, D-30-2  | Client refined: a millisecond tie keeps the server's order                         | D-251-15          |
| D-117-65 to D-117-69       | Kept: the first new record is credited; locks stay session, household, notes       | D-251-8           |
| D-123-1 to D-123-3         | Kept: amends unchanged; a new race test for an ended session                       | D-251-5           |
| D-74-32, D-74-34, D-76-6   | Kept: no move, and the same check order                                            | D-251-2           |
| D-07-1, D-07-2, D-07-3     | Kept: identity only learnt, visits never overwritten, client ids                   | D-251-4, D-251-6  |
| D-132-4, D-132-5, D-117-40 | Kept: `POST /visits` untouched; sync locks no user; one list rule                  | D-251-14          |

## Evidence

- Round trips per batch (builder; verifier r1 re-ran it against `origin/dev`'s
  `sync.ts` and matched every count). New records cost 17 whether 1, 25 or 100 are sent
  (they cost 425 for 25 before). Replays cost 7 (150 for 25 before), and 25 amends cost 232. The full table is R-249.
- Verifier r1 at 27d2f72: PASS on a Pixel 5 and an iPhone 13. E2E: 189 passed and 7
  skipped, including the 21-visit timeline.
  - 30 offline records went out as 25 + 5, and 28 in a follow-up session as 25 + 3;
    each landed once.
  - The door taken off the list was refused alone, and the first record at a door was
    credited.
  - Replays, a 29-item mixed batch, and three concurrent resends beside an admin's batch
    in reverse order all behaved; nothing deadlocked.
- Bites: tests failed when the microsecond offset, `unit_number` in the SET, the fold
  order, the first-record credit or the fallback was broken. They also failed for
  per-record answer reads, an id tie-break on the phone, and a household or list match
  by unit only (builder, verifier r0 and r1).

## Known limits

- Amends are not batched (D-251-5), so 25 amends are still 232 round trips.
- Suppose the answer read fails while another item in the batch was refused. The written
  items come back `internal_error` while the server answered the others, so D-33-27
  charges each one an attempt; the resend answers `unchanged`. A connection lost
  mid-batch did the same before.
- Because the fallback is silent (D-251-11), a fast path broken in production would cost
  per record again, with no log (reviewer r1).
- No test pins `BATCH_SIZE` at 25. The tests are written in terms of it, so setting it
  back to 100 passes (verifier r0, r1).
- Two tests count `teamIdFor` calls rather than behaviour. The mixed-batch test has no
  teammate amend or stranger refusal beside new records (reviewer r1).

## Relies on

D-07-1, D-07-2, D-07-3, D-07-4, D-21-1 to D-21-7, D-33-16, D-33-17, D-33-27, D-74-13,
D-74-27 to D-74-34, D-76-6, D-87-2, D-87-7, D-117-9, D-117-40, D-117-45, D-117-65 to
D-117-69, D-119-7, D-123-1 to D-123-3, D-132-4, D-132-5, D-160-2, D-160-6, D-193-1.

## Open questions

None. The batch size, keeping amends one at a time and leaving the block re-read alone
are engineering calls, recorded above. No accepted decision is contradicted.
