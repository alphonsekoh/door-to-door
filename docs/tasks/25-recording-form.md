# #25 · Unit recording form

- **Status:** Done (PR #63)
- **Phase:** 4 - Member UI
- **Depends on:** #20, #24

## Task

The screen used at a door.

## Decisions

- **D-25-1 · Two-tap path: unit, interest, save.** "No response" spans its own row;
  optional fields are collapsed behind _Add details_.
- **D-25-2 · Interest is four large buttons, not a select.** _Refined by D-113-2:_ four
  native radios, each over its whole tile, so a pick before the page is live holds.
- **D-25-3 · Known history and outstanding follow-ups show before knocking.** A failed
  lookup never blocks recording. _Refined by D-196-4 and D-196-18 (owner, 2026-11-18):_
  the history panel is last in the form, after the interest picker and Add details, and
  a held line under the unit field says its key facts (the follow-up list, Overdue, the
  visit count) and leads down to it. At the default text that line is above Save on
  every phone measured. _Refined by D-196-29 (owner):_ the line is there only for a unit
  among the block's units read.
- **D-25-4 · Save is pinned above the bottom nav.** _Why:_ history pushed it below the fold.
  _Refined by D-111-20:_ `DockedActions`, glass only while pinned and meeting the nav edge
  to edge; `DockHost` holds it at the end of the block screen and the offline shell.
  _Refined by D-111-40:_ Save is in the first paint, where it docks.
- **D-25-5 · After saving, the next unit is suggested** (`#12-07` → `#12-08`), or
  nothing when the numbering is unrecognised. _Refined by D-111-69:_ the Saved line and
  the suggested unit are then scrolled into view, clear of the pinned chrome. _Refined
  by D-117-19:_ never in a follow-up session, and Save says "and next" only once the
  session is known to be door-to-door.
- **D-25-6 · Optional fields send `null`, never `""`.** Relies on D-10-3.
- **D-25-7 · Visit ids are UUIDv7 generated on the client.** Implements D-07-3.
- **D-25-8 · A failed save keeps everything typed.**
