# #25 · Unit recording form

- **Status:** Done (PR #63)
- **Phase:** 4 - Member UI
- **Depends on:** #20, #24

## Task

The screen used at a door.

## Decisions

- **D-25-1 · Two-tap path: unit, interest, save.** "No response" spans its own row;
  optional fields are collapsed behind _Add details_.
- **D-25-2 · Interest is four large buttons, not a select.**
- **D-25-3 · Known history and outstanding follow-ups show before knocking.** A failed
  lookup never blocks recording.
- **D-25-4 · Save is pinned above the bottom nav.** _Why:_ history pushed it below the fold.
- **D-25-5 · After saving, the next unit is suggested** (`#12-07` → `#12-08`), or
  nothing when the numbering is unrecognised.
- **D-25-6 · Optional fields send `null`, never `""`.** Relies on D-10-3.
- **D-25-7 · Visit ids are UUIDv7 generated on the client.** Implements D-07-3.
- **D-25-8 · A failed save keeps everything typed.**
