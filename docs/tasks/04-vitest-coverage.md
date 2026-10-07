# #4 · Vitest projects and per-glob coverage thresholds

- **Status:** Done (PR #42)
- **Phase:** 0 - Foundation

## Task

Test runner with unit, integration and component projects, and coverage gates per glob.

## Decisions

- **D-04-1 · Projects selected by filename suffix.** `*.test.ts` unit,
  `*.integration.test.ts` integration, `*.test.tsx` components. _Why:_ no directory
  bookkeeping.
- **D-04-2 · Per-glob thresholds:** 100% for `src/lib`, `src/server`, `src/db`,
  `src/app/api`; 90% for `src/components`, `src/app`. _Why:_ a global number hid an
  uncovered branch at 96%.
- **D-04-3 · `coverage.include` lists every source file.** _Why:_ otherwise an untested
  file contributes nothing and passes.
- **D-04-4 · No `passWithNoTests`.** _Why:_ a broken include glob would pass CI silently.
