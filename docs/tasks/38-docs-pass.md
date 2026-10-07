# #38 · Final documentation pass

- **Status:** Open (partly started: `docs/` created)
- **Phase:** 7 - Hardening

## Task

README, CLAUDE.md and `.env.example` reconciled with what was built; the OpenAPI
workflow and offline model documented; ADR-style notes for contested decisions.

## Decisions

- **D-38-1 · Decisions live in `docs/tasks/`, one file per issue, with stable IDs.**
  These serve as the ADRs the issue asks for: household/visit split (D-07-1, D-07-2),
  JWT sessions (D-13-1), one active session (D-07-4), Serwist (D-32-1).
- **D-38-2 · `docs/` is maintained by the `docs` agent** as part of every task.
