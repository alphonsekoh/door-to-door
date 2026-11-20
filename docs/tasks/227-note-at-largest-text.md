# #227 · The note in Suggest a return visit at 32px on an iPhone

- **Status:** In progress (branch fix/227-follow-up-note-at-32px; no PR yet)
- **Phase:** 7 - Hardening
- **Depends on:** #214, #221

## Task

At 32px on an iPhone 13 the note box in "Suggest a return visit" is 226px, taller than
the 199px of room above the sheet's Send bar, so after focus its foot stays under the bar
(D-214's known limits). Measure whether the line being typed is ever under the bar, then
fit the note or record the limit. The owner recorded the limit: docs only, with no
contract, schema, server, UI or test change.

## Decisions

- **D-227-1 · Measured first: in the browser the line being typed stays clear of Send.**
  At 32px on an iPhone 13 it was never under the bar (0 of 750 keystrokes), at worst
  15.5px above, because both engines scroll the sheet's body to the caret within its
  scroll padding (D-136-3). Only the box's foot is under the bar, 21.6px after Shift+Tab
  and 42.6px after Tab or a tap, until the text reaches it. The Pixel 5 fits the box,
  10.9px above the bar. _Why:_ the issue made the choice depend on this reading.
  _Research:_ R-221.
- **D-227-2 · Installed, the line being typed goes under the bar, and that is #230's.**
  At 28 and 32px on both engines it was under in 81 of 150 keystrokes after Tab or a tap,
  by up to 17.5px, about half a line. The box fits there (226px in 318px on an iPhone
  13). With #230's fix simulated it stays at least 16.5px above, at four rows; a
  three-row box alone still had 95 of 150 under. #230's check gains typing in this note.
  _Why:_ the cause is the inset the scroll padding leaves out (R-184, D-136's safe-area
  limit), not the box's height. _Research:_ R-184, R-221.
- **D-227-3 · The note's foot under Send at 32px on an iPhone 13 in the browser is a known
  limit (owner, 2026-11-20).** It is recorded against D-111-31's "fully into view" and
  D-136-3's 16px clearance, superseding neither, as D-136 did with its inset limit. The
  note stays four rows at every size. _Why:_ the issue's condition for accepting it holds
  (D-227-1). _Not taken:_ a `note-lines` utility, four rows or three on a short screen
  through D-111-48's `--short-by` clamp. Three rows end only 5.4px above the bar on an
  iPhone 13 after Tab or a tap, a margin CI's Linux WebKit fonts or a taller header would
  erase; they do not help installed (D-227-2); and they show a row fewer where a row
  holds a few words.
- **D-227-4 · Out of scope: `scroll-clear-sheet-actions` and D-221-8's one-slot bar,
  which is kept.** No test is added, as nothing under `src/` changes. _Why:_ the owner
  put the padding's inset fix, for every sheet, in #230 (D-225's open question).

## How existing decisions are handled

| Decision                       | Effect                                                                           | By          |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------- |
| D-111-31                       | Known limit: at 32px on an iPhone 13 the note is not fully in view               | D-227-3     |
| D-136-3                        | Known limit for the box's foot; the line being typed stays at least 15.5px clear | D-227-1, -3 |
| D-136's safe-area limit        | Measured for this note while typing (up to 17.5px under); left to #230           | D-227-2     |
| D-214's known limit (the note) | Measured and accepted (owner)                                                    | D-227-1, -3 |
| D-111-48                       | Not extended: no short-screen switch for the note                                | D-227-3     |
| D-221-8                        | Kept: the one-slot bar                                                           | D-227-4     |

## Evidence

- Planner's measurement at 4a79e6e on the production build, Pixel 5 (Chromium) and
  iPhone 13 (WebKit), in the browser and installed (simulated), at the default text and
  24, 28 and 32px; focus by Tab, Shift+Tab from Send and a tap; 150 keystrokes a case
  (R-221). The sheet is unchanged at 5566d4b: #231 touched only the sessions screens.
- The default size is untouched: a 114px box, 110px above the bar, on every phone and
  mode.
- The owner chose B, "Accept as a limit", on 2026-11-20.

## Known limits

- At 32px on an iPhone 13 in the browser, the note's foot is under Send from focus until
  the text reaches it (D-227-3). Then the body scrolls 58px: the foot ends 15.4px clear,
  and the box's top row goes under the header. On the Pixel 5 the box is in view
  but ends 10.9px above the bar, inside D-136-3's 16px.
- Installed, until #230 lands, the line being typed goes up to 17.5px under the bar at 28
  and 32px (D-227-2).
- Not measured: the admin's Add to the follow-up list opened from Needs a return visit,
  with its context line (the seed has no rows there; its room depends only on the header,
  so the same result is expected); a real iPhone at its 17px default with SF metrics; the
  on-screen keyboard, which covers the bar while typing on a real phone; a real installed
  app (the inset was simulated); VoiceOver and TalkBack.

## Follow-ups (owner)

- #230: add the check of D-227-2. Installed at 28 and 32px, typing five lines into this
  note keeps the line being typed above the bar.
- For #230's verifier: installed, content scrolls through the 34px strip below the bar,
  and "Go back by (optional)" was drawn under Send (R-184).

## Relies on

D-111-31, D-111-48, D-119-21, D-136-1, D-136-3, D-214-9, D-221-8.

## Open questions

None. The owner settled the choice on 2026-11-20 (D-227-3).
