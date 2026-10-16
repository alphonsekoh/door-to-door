# #33 · IndexedDB write queue and sync engine

- **Status:** In review (PR #99)
- **Phase:** 6 - PWA & Offline
- **Depends on:** #21, #32

## Task

Write to IndexedDB first, then sync; never lose a record to a dead spot. The engine is
pure functions over a `SyncQueue` interface (`src/lib/sync/`), so #34 can test it
without a browser.

## Decisions

Owner decisions are marked **(owner)**.

- **D-33-1 · Shared phone: records belong to the member who saved them (owner).** Only
  the owner's records are listed or sent; another member's stay on the phone, hidden, and
  send when that member signs in again. Sign-out never clears the queue, and no future
  clear of a previous member's local copy (#77) may include it. Every batch first asks
  `/api/auth/session` (no-store) who is signed in; anyone else or nobody pauses the queue
  as signed out, and an unanswered check waits like no signal. The provider keeps the
  last confirmed member across a failed session refetch; a public page clears it.
  _Why:_ the sync request carries no owner, so the cookie decides whose name a record is
  stored under; a stale tab must never send A's records as B. _Research:_ R-44.
- **D-33-2 · No discard (owner).** Held and quarantined records cannot be discarded;
  Retry is the only action. The only delete is the purge of sent records (D-33-9).
  _Why:_ nothing unsent is ever dropped.
- **D-33-3 · Item `clock_skew` restamps (owner).** `clientCreatedAt` and `updatedAt`
  are set to now and the record goes again at once; from the second skew, at most every
  5 minutes. Skew does not count toward the cap. _Why:_ a record that can never pass is
  worse than one stamped late; consistent with D-76-4, and D-76-7 counts the refusals.
- **D-33-4 · Retry cap (owner).** ~~8 attempts; the 8th failure quarantines.~~
  Superseded by D-33-26. Backoff from 5 s, doubling, capped at 5 min, full jitter.
  Counts `internal_error` and a missing result~~, and server failures while isolated
  (D-33-6)~~ (superseded by D-33-27). Network errors never count. A single item
  refused `400` is quarantined at once. _Why:_ a deterministic failure must not retry
  forever (D-74-30). ~~Worst case to quarantine is 615 s.~~ Superseded by D-33-26.
- **D-33-5 · Sends go through `apiFetch` with a fresh `sentAt` and a 20 s timeout.** A
  `401` or `403 account_deactivated` raises the account screen like any request; a
  timeout counts as no signal. _Why:_ closes D-85-10 with no second path into the
  account store; a stale `sentAt` reads as skew (D-76-3); a lost reply must not stall
  the queue, and the id makes a resend harmless (D-21-1). _Research:_ R-36.
- **D-33-6 · Isolation mode.** After 3 whole-batch server failures in a row, or a
  `400`, the engine sends one item per request until the due list is empty or a Retry.
  A batch where every item is `internal_error` counts as a whole-batch failure~~, so
  only a record that fails alone is charged~~ (superseded by D-33-27). _Why:_ finds a poison record without holding the
  good ones, and a database outage (D-87-2) must not quarantine the whole queue.
- **D-33-7 · One sender per origin.** Runs hold a `navigator.locks` lock; without Web
  Locks the run goes ahead in-tab. Tabs tell each other to re-read over
  `BroadcastChannel`. _Why:_ the server's idempotency keeps a double send harmless, so
  the lock is an economy, not a guarantee. _Research:_ R-45.
- **D-33-8 · Every stored record is validated on read.** A record failing the generated
  schema comes back quarantined as `corrupt`: never thrown, never deleted, never sent,
  not retryable. _Why:_ storage outlives the code that wrote it; deleting may drop a
  real knock.
- **D-33-9 · Sent records are kept 24 h, purged on app start.** _Why:_ the unit list
  and Add follow-up need the server's row after the send.
- **D-33-10 · The form saves to the queue first.** It falls back to a direct
  `POST /visits` only when the queue cannot be written (no IndexedDB, full disk), where
  D-25-8 keeps what was typed. _Why:_ a save never waits on the network.
- **D-33-11 · Add follow-up appears only once the saved visit's server row is known.**
  Refines D-35-10 for queued saves. _Why:_ the server can only anchor to a stored visit
  (D-22-3).
- **D-33-12 · Sync status bar.** Sticky at the top of `main` (`z-20`, under
  `--banner-top`), its one-line row held on every signed-in page from first paint; it
  opens a sheet (`z-50`) with each record's state, a fixed reason, Retry and Retry all.
  A record saved on this page does not count until its first send ends; the form's
  `role="status"` line says "Saved". _Why:_ the bar appearing mid-form would move the
  form under a thumb; saving with signal must not flash it.
- **D-33-13 · Amends and on-behalf recording stay online-only.** Units known only to
  the queue are not tappable. _Why:_ amending needs the server's row; D-74-19.
- **D-33-14 · Update prompt waits only for the member's records still being sent
  (owner).** `hasRecordsToSend(ownerId)`: queued or failed records of the signed-in
  member. Held, quarantined and other members' records don't block an update;
  IndexedDB keeps them across the reload. Refines D-32-6. _Why:_ records that only a tap
  or an admin can move would hold every update back indefinitely.
- **D-33-15 · The sign-out warning counts all the member's own unsent records
  (owner).** `hasUnsyncedItems(ownerId)` includes held and quarantined records; the
  sign-out confirmation (D-74-9) and the account screen (D-85-9) use it. Both checks
  say false when IndexedDB cannot be read. _Why:_ they are still that member's unsent
  work; a broken store must not trap anyone.
- **D-33-16 · Per-item results.** `applied`, `unchanged`, `stale` are sent.
  `internal_error` retries with backoff (D-33-4). `session_not_active` is held and
  probed every 5 min (D-21-4). `conflict`, `not_found` and any unknown code are held
  for a tap (D-74-23). _Why:_ only an admin's action can change those answers.
- **D-33-17 · Whole-batch responses.** No signal: queue-level backoff, nothing charged.
  `429`: wait 60 s, kept even on Retry. `401` or another member signed in: paused until
  the next page load. `403 account_deactivated` and `422 clock_skew`: retried at most
  every 5 min (D-83-4, D-76-7). `5xx` or an unparseable `200`: backoff. _Why:_ the
  server's own answer decides the wait; a tap past a `429` would only earn another.
- **D-33-18 · Retry resets attempts and skew count and lifts the engine's own waits**
  (backoff, isolation, 5-minute probes), but not a `429` wait or a sign-out pause.
  _Why:_ a tap means "try now", but the server chose those two.
- **D-33-19 · Triggers: app start, each save, `online`, focus and visibility, the
  backoff timer, Retry.** No Background Sync. `navigator.storage.persist()` is asked
  once on the first save and its answer ignored. _Why:_ D-32-5 and R-19: the worker
  never opens IndexedDB, and iOS has no Background Sync. _Research:_ R-46.
- **D-33-20 · Fixed wording only.** The server's message is never shown. The sheet
  says unsent records are on this phone only. _Why:_ the server's text was written for
  a request, not a record read days later; D-74-1.
- **D-33-21 · The unit list overlays unsent records.** A worded chip ("Not sent",
  "Sending…"), and unsent records count toward tonight's progress. The block screen
  re-reads the server only when one of the member's records is sent. _Why:_ #26's
  criteria; a save in a dead spot must not trigger a fetch that fails.
- **D-33-22 · `/offline` reloads itself on `online`** (to `/` when the address is
  `/offline`), so the member's queue starts with no tap. Not Serwist's
  `reloadOnOnline`, which stays off (D-32-14): this page holds no input. _Why:_ no
  queue runs on the offline page.
- **D-33-23 · `beforeunload` warns while the member's records are being sent.** _Why:_
  issue criterion; closing loses nothing, but the member should know it has not gone.
  Refined by D-33-28.
- **D-33-24 · Storage layout.** Database `door-to-door` v1, store `visits` keyed by id,
  one index `by-owner`. "Sending" is never stored. A tab blocking a newer build's
  upgrade closes its connection. _Why:_ in-flight is a fact about a page, not a record.
  Scope cut: the planned `by-state` index was not needed.
- **D-33-25 · A new visit is queued only with its outing (owner).** With no known
  `sessionId` the form asks `/sessions/active` again, giving up after 4 s; if that fails
  nothing is queued, the form keeps what was typed (D-25-8) and says the outing could not
  be loaded. `VisitDraft` and the stored item require `sessionId`; a stored record
  without one reads as corrupt (D-33-8). The direct `POST /visits` fallback (D-33-10) is
  unchanged. _Why:_ sent later it would join a later outing with a restamped time;
  closes the D-76 known limit for new records, as D-74-32 did for stored ones. Weak
  signal stalls rather than fails, so the ask needs its own limit. Refined by D-33-30.
- **D-33-26 · Retry cap: 10 attempts (owner).** Supersedes the count in D-33-4. Same
  backoff; the 10th failure quarantines after 9 waits, at most 1215 s (about 20 min).
  _Why:_ the owner's choice: 8 gave at most 615 s against the "about 15 minutes" first
  asked for.
- **D-33-27 · A whole-request failure is never charged to a record, isolation
  included.** No signal, timeout, `5xx`, an unreadable `200`, or a request where every
  item is `internal_error` only backs the queue off. Only a per-item failure while the
  server answered others in the same request, a missing result, or a single-item `400`
  counts. In isolation the record that has waited longest goes first. Supersedes the
  isolation clauses of D-33-4 and D-33-6. _Why:_ during an outage every single-record
  request fails the same way, so charging it quarantined good records in about 20 min
  (D-87-2). Trade-off: a record that breaks every request it is in retries every
  5 min instead of quarantining (see known limits).
- **D-33-28 · The app's own navigations skip the `beforeunload` warning.** `goTo`
  (used by sign-out) and the update prompt's `reloadPage` set a "leaving on purpose"
  flag; `pageshow` clears it. Refines D-33-23. _Why:_ tapping Stay on a chosen
  sign-out left the member signed out on a page that still looked signed in; a page
  restored from the back/forward cache must warn again.
- **D-33-29 · A failed save is shown beside Save, and focus is not moved.** The form's
  `role="alert"` sits in the sticky bar above Save, for every save failure (outing
  unknown, no outing running, direct `POST /visits` failed). Chosen over scroll-and-focus.
  _Why:_ the bar is always on screen, so no scroll offsets or reduced-motion handling;
  at the top of a long form it could be off screen. Trade-off: a two-line message makes
  the bar taller until the next attempt. Focus stays where the disabled button dropped
  it (see known limits).
- **D-33-30 · Only a `404` means "no outing running".** Refines D-33-25: asking for the
  outing answers running (with id), none, or unknown; a network error, `5xx` or the 4 s
  timeout is unknown. None says "No outing is running"; unknown keeps "Could not load
  the outing … Check your signal". Neither queues, both keep what was typed. _Why:_ the
  member needs to know whether to find signal or ask an admin; D-10-7 makes `404` the
  empty state.

## Relies on

D-07-3, D-21-1 to D-21-7, D-25-6 to D-25-8, D-26-5, D-32-5, D-32-6 (refined by
D-33-14), D-35-10, D-74-1, D-74-9, D-74-19, D-74-23, D-74-30, D-74-32, D-76-3 to
D-76-7, D-83-4, D-85-9, D-85-10, D-87-2.

## Inherited by other tasks

- **#77 (offline recording screen):** clearing a previous member's local copy must
  never touch the queue (D-33-1), and only the confirmed member's records may be shown
  or sent. It reuses the bar (D-33-12) and the unit overlay (D-33-21), and replaces
  the `/offline` reload (D-33-22).
- **#34 (offline tests):** fuzzing over online/offline sequences, real-database
  convergence, quota simulation and a corruption-recovery suite were left out. Pin
  these: nothing unsent deleted (D-33-2), owner scoping (D-33-1), the cap (D-33-26),
  an outage not charged (D-33-27), no outing means not queued (D-33-25).

## Known limits

- A corrupt record (D-33-8) can be neither retried nor discarded, so it counts toward
  the sign-out warning and the bar's "not sent" until #34's corruption work recovers it.
- A record whose request fails as a whole every time, even sent alone (a `5xx` or an
  all-`internal_error` reply), is never quarantined; it retries at most every 5 min
  behind the others (D-33-27). Only the server log shows it.
- After a failed save focus falls to `<body>`, because Save is disabled while saving
  (D-33-29). The alert is announced, but a keyboard user starts again from the top.
  D-85-15 returns focus to the button in the same situation on sign-out; doing the same
  here is a small follow-up.

## Open questions

None. The retry window was answered by D-33-26, the missing `sessionId` by D-33-25.
