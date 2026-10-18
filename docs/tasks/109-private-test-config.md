# #109 · Integration runs share one temp config path

- **Status:** In review (PR #110)
- **Phase:** 7 - Hardening
- **Depends on:** #75, #87

## Task

`applyTestConfig` wrote the integration `config.yaml` to a fixed
`tmpdir()/door-to-door-test-config/`, so two runs on one machine (two worktrees, two
terminals) overwrote each other's config and hit each other's database.

## Decisions

- **D-109-1 · Each run gets a `mkdtemp` folder, created in the integration globalSetup
  and passed to workers as `DOOR_TO_DOOR_TEST_CONFIG_DIR`.** The setup file still writes
  `config.yaml` there and sets `CONFIG_PATH` per worker. _Why:_ globalSetup runs once per
  run before workers start, and workers inherit its `process.env`, so one run agrees on
  the folder and a second run does not. _Research:_ R-59.
- **D-109-2 · Env var, not Vitest `provide`/`inject`.** _Why:_ typing `inject` needs an
  `interface ProvidedContext` augmentation, which the `consistent-type-definitions: type`
  rule (D-03-2) forbids.
- **D-109-3 · `applyTestConfig` throws when the folder is unset; no fallback to a shared
  path.** _Why:_ a silent fallback would bring back the clobbering it fixes.
- **D-109-4 · The folder is removed by Vitest's teardown and also on `exit` and the first
  `SIGINT`/`SIGTERM`; removal is idempotent.** _Why:_ Ctrl-C skips Vitest's teardown, and
  npm forwarding a second signal kills Vitest outright. _Research:_ R-59.
- **D-109-5 · `src/db/testing.ts` stays excluded from coverage (D-36-1) but gains a unit
  test, `src/db/testing.test.ts`.** _Why:_ the per-run folder and the refusal are
  behaviour worth pinning; the rest of the harness is still exercised only indirectly.
- **D-109-6 · README tells parallel runs to use different `TEST_DATABASE_URL`s.** _Why:_
  the folder is private but each run still truncates its database.

## Relies on

D-03-2, D-04-2, D-06-3, D-36-1, D-75-7, D-75-8.

## Open questions

None.
