# #76 · Clock rules on sync and record endpoints

- **Status:** In review (PR #80)
- **Phase:** 6 - PWA & Offline
- **Depends on:** #21, #75

## Task

Stop a wrong or tampered phone clock from winning last-write-wins conflicts, using only
what the server can verify itself. Applies to `POST /visits/sync` and `POST /visits`.

## Decisions

- **D-76-1 · One configurable tolerance serves all checks.**
  `sync.clockSkewToleranceSeconds` in `config.yaml`, default 300. _Why:_ one knob, one
  mental model (D-75-15 reserved the key).
- **D-76-2 · No client-sent "dead zone" flag.** _Why:_ it would be client-controlled and
  visible in the bundle and the spec; the server checks only what it can verify.
- **D-76-3 · Batch check on `sentAt`.** `sentAt` is required and regenerated on every
  attempt. A difference from server time beyond the tolerance, either direction, refuses
  the whole batch `422 clock_skew` and applies nothing. This is a breaking change to the
  sync request. _Why:_ detects a wrong clock early and cheaply; it does not authenticate
  the clock, since the client chooses `sentAt`.
- **D-76-4 · Per-item bounds.** `updatedAt` and `clientCreatedAt` more than the tolerance
  ahead of the server, or earlier than the session's `startedAt` minus the tolerance,
  reject that item `clock_skew`; siblings still apply. A dead-zone record hours old but
  inside the outing is accepted. _Why:_ the per-item bounds are the real guard (a
  tampered client can still pick any stamp between session start and now plus tolerance);
  nothing is discarded, the client restamps and retries.
- **D-76-5 · Online `POST /visits` gets the future bound** on `clientCreatedAt` (`422
clock_skew`). _Why:_ same rule on every write path. No lower bound there.
- **D-76-6 · Check order in a sync item.** Ownership, stale and unchanged short-circuits
  first; then the future bound; then `resolveSession` (so `session_not_active` still
  reports first); then the lower bound; all before any write. _Why:_ a replay is always
  `unchanged` (D-21-1) even if the tolerance was later lowered.
- **D-76-7 · The rate limiter runs before the batch `sentAt` check**, so a 422 consumes
  budget. _Why:_ it stops probing the tolerance. A test pins it. Consequence: a
  wrong-clock phone retrying fast would see `rate_limited`, so the client probes
  clock-blocked records at most every 5 minutes (#33).
- **D-76-8 · `resolveSession` returns a non-null `startedAt`** via `presentOrThrow`
  (`InternalError` if absent). _Why:_ activation always sets it; no dead branch to test.
- **D-76-9 · Placement.** Pure helpers in `src/lib/clock.ts`; rules in
  `src/server/visits/clock-rules.ts`; config read lazily per call (D-13-4, D-75-9).
  _Why:_ `src/lib` is the easiest place to test; `next build` has no config file.
- **D-76-10 · Messages state approximate minutes and direction only**, rounded with
  `Math.round`. _Why:_ enough to tell the member what to fix, nothing to probe with.

## Known limits

- An item omitting `sessionId` resolves to the current active session, so the lower
  bound compares an old visit's `clientCreatedAt` to the new session's start. The queue
  (#33) must always send the visit's own `sessionId`, including on amends.
- (Closed for stored visits by D-74-32: a stored visit keeps its own outing when an item
  omits `sessionId`. A NEW item without one still resolves to the active session.)
- `sentAt` is client-chosen; see D-76-3 and D-76-4.

## Relies on

D-21-1, D-21-2, D-21-4, D-21-5 (refined, not changed), D-75-9, D-75-15, D-13-4.
