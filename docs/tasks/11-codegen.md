# #11 · Codegen from the contract

- **Status:** Done (PR #50)
- **Phase:** 1 - Data & Contract
- **Depends on:** #10

## Task

Generate types and Zod schemas from `openapi.yaml`, committed and drift-checked in CI.

## Decisions

- **D-11-1 · Types and Zod only; no generated SDK/client.** Callers use `fetch`.
  _Why:_ the generated runtime fails `exactOptionalPropertyTypes` (12 errors), and the
  offline queue needs its own transport anyway. _Research:_ R-5.
- **D-11-2 · `src/generated/` is committed and never hand-edited.** CI regenerates and
  fails on any difference.
- **D-11-3 · Contract tests parse payloads through the validators** (e.g. an all-null
  household parses; a sync batch over 100 items does not) rather than reading YAML.
