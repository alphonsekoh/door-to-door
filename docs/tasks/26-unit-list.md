# #26 · Block unit list with quick amend

- **Status:** Done (PR #64)
- **Phase:** 4 - Member UI
- **Depends on:** #25

## Task

Everything known on a block, grouped by floor, searchable, tappable to amend.

## Decisions

- **D-26-1 · Record and Units are tabs, not one page.** _Why:_ keeps Save on screen (D-25-4).
- **D-26-2 · The list shows the block's whole history; rows from the running outing are
  marked `tonight`, and progress counts only those.**
- **D-26-3 · Progress is units, floors and answered — no percentage.** _Why:_ the app
  never knows how many units a block has.
- **D-26-4 · Interest chips carry the word as well as the colour.** Relies on D-01-2.
- **D-26-5 · Amend sends only changed fields and never sends identity as `null`.**
  Consequence: a wrongly recorded name can be corrected but not removed.
- **D-26-6 · Units sort numerically; unrecognised numbering collects under "Other units".**

## Open

Two acceptance criteria — queued units in the list, and queued units looking distinct —
move to #33.
