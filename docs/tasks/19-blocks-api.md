# #19 · Blocks API

- **Status:** Done (PR #56)
- **Phase:** 3 - Core API

## Task

Block registry: list with search, create, amend.

## Decisions

- **D-19-1 · `(name, street)` is the natural key; a duplicate is `409`.** Values are
  trimmed. _Why:_ two rows for one block split its history.
- **D-19-2 · Every PATCH handler calls `requireChanges(body)`.** _Why:_ the generator
  drops `minProperties`, so `{}` reached Drizzle and returned `500`. _Research:_ R-5.
- **D-19-3 · `isConstraintViolation(error, name)` is shared; unrelated errors rethrow.**
- **D-19-4 · Search is partial and case-insensitive over name and street; blank search
  is ignored.**
- **D-19-5 · Readable by any signed-in user; writes are admin-only.**
