# #87 · Handle pg pool errors so a database restart cannot crash the server

- **Status:** Done (PR #91)
- **Phase:** 7 - Hardening
- **Depends on:** #12, #75, #83

## Task

Bug fix. A database restart, failover or `pg_terminate_backend` produced
`uncaughtException: Connection terminated unexpectedly`: no pool had an `error` listener.
Fixing it exposed a second leak, below: unexpected errors were logged raw.

## Decisions

- **D-87-1 · Every pool the app, scripts and test helpers create gets
  `attachPoolErrorHandler` (`src/db/pool-errors.ts`).** That covers `createDatabase`,
  `scripts/migrate.ts`, `scripts/seed.ts`, `createTestPool` and both pools in
  `e2e/global-setup.ts`. It listens for `error` on the pool and, on `connect`, on each new
  client. _Why:_ pg-pool only listens on idle clients, so an error on a checked-out client
  was the uncaught path. _Research:_ R-38.
- **D-87-2 · A dead connection still rejects the in-flight query; nothing fails open.**
  Handlers return `500 internal_error`, and sync rejects the item with retryable
  `internal_error`. The listener only stops the crash. The pool drops the dead client and
  reconnects on the next query without a restart. _Why:_ an outage must not grant access
  (D-83-5) or park good records (D-74-30). _Research:_ R-38.
- **D-87-3 · The app pool is a process-wide singleton on
  `Symbol.for("door-to-door.database")`, still created lazily.** Extends D-13-4, D-75-9
  and D-83-8. _Why:_ Next bundles instrumentation, the proxy and routes as separate module
  graphs. Without it each graph opened its own pool and listener, and HMR leaked pools.
  _Consequence:_ a change to `database.url` in `config.yaml` needs a process restart.
- **D-87-4 · One shared sanitiser, `summarizeError` (`src/server/logging/error-log.ts`),
  used by the pool handler, `withContract`'s catch and the sync catch.** It keeps the
  error name, its code (or the cause's code), and the first line of the message, capped
  at 200 chars. URLs, emails, UUIDs, Postgres `=(value)` row echoes, IPv4/IPv6 and bare
  `host:port` are redacted. The request body, params, the cause's message and the cause
  chain are never logged. Extends D-75-5 ("never a value") from config errors to runtime
  errors. _Why:_ a raw pg error carries the host, port and query parameters (user ids).
- **D-87-5 · Logging is throttled per key: one line per 5 s burst.** The next line after a
  burst adds `(N similar suppressed since HH:MM:SSZ)`. The keys are the pool, each
  `operationId` and sync. _Why:_ an outage fails every request at once, and one line is
  what an operator needs.
- **D-87-6 · A failed client is reported once (a `WeakSet` of clients).** _Why:_ one dead
  backend arrives up to three times (client, pool re-emit, socket end). Without the set,
  the suppressed count would overstate real failures.
- **D-87-7 · Throttles live in module scope, accepted.** The contract and sync throttles
  are per module graph, so the worst case is one line per graph per burst. During a sync
  burst only the first failing item's id is logged. Refines D-74-30: the id is still the
  only identifier logged, but a suppressed item's id is not logged at all. _Why:_ the
  client retries the item anyway, so per-item logs during an outage add nothing.
- **D-87-8 · `withContract` logs `<operationId> failed: <summary>`; the `500` body is
  unchanged.** _Why:_ the operation is the useful context, and the client contract does
  not move.
- **D-87-9 · Fixed in passing: `withContract` used to `console.error` the raw error.**
  During a 12 s outage that logged the database host:port, address and query parameters
  (user UUIDs) 520 times. D-87-4 and D-87-5 replace it.
- **D-87-10 · Known limits.** (a) Two short-lived test pools have no handler: the one in
  `vitest.globalSetup.integration.ts` and the `controller` pool in
  `sync-races.integration.test.ts`. (b) Only the app's own logging is sanitised. Whether
  Next's framework logs ever print the database host was not checked.

## Evidence

From the verifier, using a `pg_terminate_backend` loop against the production build.
`main` logged 136 `uncaughtException`s and this branch logged 0. A 12 s outage failed
closed: `500`, never `2xx` or `401`. Requests recovered without a restart.

## Relies on

D-12-1, D-13-4, D-74-30, D-75-5, D-75-9, D-83-5, D-83-8.

## Notes

Issue #88, which is not a decision, now also covers a second flaky test (`update-prompt`).

## Open questions

None.
