# #7 · Drizzle schema

- **Status:** Done (PR #43)
- **Phase:** 1 - Data & Contract

## Task

Tables for users, blocks, sessions, session blocks, households, visits and follow-ups,
with the constraints that carry the domain rules.

## Decisions

- **D-07-1 · Household = `(block_id, unit_number)`, unique.** Name, contact, religion are
  nullable latest-known fields, only ever updated with non-null values. _Why:_ a later
  visit that learns nothing must not erase what an earlier one recorded. **Invariant.**
- **D-07-2 · `interest_level` and `description` live on the visit and are never
  overwritten.** _Why:_ the interest trajectory over time is the product. **Invariant.**
- **D-07-3 · `visits.id` has no database default; the client supplies a UUIDv7.**
  _Why:_ a default would duplicate a replayed offline write. A test asserts
  `hasDefault === false`. **Invariant.**
- **D-07-4 · One active session, by partial unique index on `status = 'active'`.**
  _Why:_ two concurrent starts are a race the API cannot close. **Invariant.**
- **D-07-5 · Follow-ups attach to the household; `visit_id` is `set null` on delete.**
  _Why:_ losing a visit must not lose the promise made at the door. **Invariant.**
- **D-07-6 · `auth_sessions` exists but is unused.** _Why:_ the adapter requires it;
  sessions are JWTs (D-13-1).
- **D-07-7 · Enums are `pgEnum`:** religion, interest level (incl. `no_response`), role,
  session status.
