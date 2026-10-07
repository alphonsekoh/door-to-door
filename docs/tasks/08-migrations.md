# #8 · Initial migration and drizzle-kit scripts

- **Status:** Done (PR #44)
- **Phase:** 1 - Data & Contract
- **Depends on:** #7

## Task

Generate the first migration and the scripts to apply it.

## Decisions

- **D-08-1 · Migrations come only from `drizzle-kit generate`; applied ones are never
  edited.** Named explicitly (`0000_initial_schema`).
- **D-08-2 · Runner in `scripts/`, logic in `src/db/env.ts`.** _Why:_ entrypoints that
  need a live database stay outside the 100% gate; the testable logic stays inside it.
- **D-08-3 · No `dotenv`; Node's `process.loadEnvFile()`.**
- **D-08-4 · Failure exits non-zero with a message naming the fix.** _Why:_ Docker's
  migrate service relies on the exit code to halt the stack.
