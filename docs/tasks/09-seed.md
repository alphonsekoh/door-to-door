# #9 · Deterministic seed

- **Status:** Done (PR #45)
- **Phase:** 1 - Data & Contract
- **Depends on:** #8

## Task

Idempotent seed with realistic history so every screen has something to render.

## Decisions

- **D-09-1 · No active session is seeded; a draft is.** _Why:_ D-07-4 allows only one,
  and seeding it would block the start flow it demonstrates.
- **D-09-2 · `passwordHash` is excluded from `ON CONFLICT` updates.** _Why:_ argon2 salts
  every call; rewriting it breaks idempotency. _Research:_ R-9.
- **D-09-3 · argon2id via `@node-rs/argon2`, added here ahead of #15.** _Why:_ prebuilt
  binaries; seeded logins need a hash. _Research:_ R-9.
- **D-09-4 · Seed data is a pure module (`src/db/seed-data.ts`)** with unit-tested
  invariants; `scripts/seed.ts` is glue. `seedDatabase()` is exported for E2E.
- **D-09-5 · Seed logins:** `admin@`, `alice@`, `ben@`, `cara@example.com`, password
  `password123`. Dev only.
