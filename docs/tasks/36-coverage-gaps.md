# #36 · Close coverage gaps

- **Status:** Done (PR #103)
- **Phase:** 7 - Hardening

## Task

Sweep after features land. Thresholds were already met on `main`, so this was an
honesty audit: no test exists only to touch a line, and unreachable code is deleted
rather than covered.

## Decisions

- **D-36-1 · Thresholds, include and exclusions stay as D-04-2/D-04-3 set them; nothing
  was loosened** (one glob added later, D-36-10). The only extra exclusions are `src/db/testing.ts` (test harness, now
  commented as such; unit-tested since D-109-5), `global-error.tsx`, `*.d.ts` and `**/*.config.*`. _Why:_ the audit
  found the config already matches the issue's targets.
- **D-36-2 · `src/` carries no coverage-ignore comments.** Remaining uncovered lines sit
  in the 90% components glob and are left uncovered, not ignored: TypeScript-only
  fallbacks (`unknown` error, nullable `name`, contract-nullable `latestVisit`),
  `install-prompt` guards only reachable once both values exist, `sync-provider`'s
  inactive `retry`/`retryAll`, and the offline page's `loadSession`/`onRecorded`. _Why:_
  a hollow test or an ignore would hide the line; the 10% margin is for exactly this.
- **D-36-3 · Unreachable code is deleted, not covered.** Removed: the
  `src/components/session-provider.tsx` wrapper (the root layout imports
  `next-auth/react`'s already-client `SessionProvider` directly); `FollowUpItem`'s
  `controls` prop (every caller set it, so controls always render); the consolidated
  history's `if (!first)` guard and empty-query redirect branch; a `cancelled` check
  inside a timeout its own cleanup clears. _Why:_ CLAUDE.md Tests rule. _Since D-113-7,_
  the root layout uses `DeferredSessionProvider`, which does work of its own.
- **D-36-4 · `groupByHousehold` returns each group's `household` and `block`.** _Why:_
  every entry for a door carries the same pair, so readers stop indexing `entries[0]`
  and the null guard goes away (under `noUncheckedIndexedAccess`).
- **D-36-5 · A stale-response test gets its own request per case.** Tests that called
  `resolve()` then `reject()` on one promise never exercised the late-failure guard.
  _Why:_ a promise settles once.
- **D-36-6 · Each new guard test is proved by breaking the guard.** 15 lines broken one
  at a time; each failed its test. _Why:_ D-06-4 applied to tests.
- **D-36-7 · "CI enforces the gate" is met as "the Tests and coverage job runs on every
  PR and goes red", not "blocks the merge".** _Why:_ GitHub refuses required checks on
  this private free-tier repo (R-51); only the owner merges, and not on red. See open
  D-36-9.
- **D-36-8 · The D-06-3 concern recorded here earlier does not reproduce.** Without
  `TEST_DATABASE_URL`, `test:coverage` fails in global setup with
  `MissingTestDatabaseUrlError`. _Why:_ verified, so no change.

- **D-36-9 · Owner: the coverage gate stays non-required; the rule is "nothing merges
  on red".** If the repo moves to GitHub Pro or goes public, add a `main` ruleset
  requiring all four CI checks (Lint types and format, Tests and coverage, End-to-end
  smoke, Production build). _Why:_ only the owner, or Claude on the owner's say-so,
  merges, so the rule holds without the API GitHub refuses here (R-51).
- **D-36-10 · Owner: root-level `src/*.ts` is gated at 100%.** Amends D-04-2's list
  (adds a glob, changes no existing threshold). Covers `src/proxy.ts` (auth guard) and
  `src/instrumentation.ts`; a one-line comment names them, since the glob does not.
  _Why:_ both sat under no glob, so a drop would have passed. Proved by dropping
  `instrumentation`'s test: 81.81% lines fails the glob.
- **D-36-11 · Owner: `RecordVisitForm` discriminated props deferred to a later cleanup.**
  The offline page keeps passing an uncallable `loadSession` and a no-op `onRecorded`
  (D-36-2). _Why:_ touches `RecordVisitForm`, `BlockViews`, `BlockScreen`; out of scope
  for a coverage sweep.
- **D-36-12 · `install-prompt`'s `onInstalled` guard is kept and now pinned by a test.**
  The existing test fired `beforeinstallprompt` then `appinstalled`, an order in which
  the guard's removal is invisible; the new test fires `appinstalled` first, before
  storage is read, and crashes without the guard. _Why:_ the guard matters, so D-36-3
  (delete) did not apply; it leaves D-36-2's list of uncovered `install-prompt` guards.

## Relies on

D-04-2, D-04-3, D-04-4, D-06-3, D-06-4, D-12-5, D-35-7 (the recording form does not use
`FollowUpItem`, so removing `controls` leaves resolved notes at the door control-free).

## Open questions

None. All three answered by the owner (D-36-9, D-36-10, D-36-11).
