# #238 · A focused field on the record page comes clear of the docked Save

- **Status:** In review (PR #240)
- **Phase:** 7 - Hardening
- **Depends on:** #136, #196, #214, #230

## Task

On the record page (`/blocks/<id>`), with Add details open, a tapped Notes stayed 66 to
154px under the docked Save and next, and installed, Tab from Religion left it under the
nav (#230's verifier, nit 2). The details fields had no `scroll-clear-chrome`, and the
page had no focus scroll like a sheet's. UI only; no contract, schema or server change.

## Decisions

- **D-238-1 · Measured first: a tap scrolls nothing, and Tab reads a field's
  `scroll-margin` only for some fields.** Both phones, in the browser and installed, at
  the default text, 28 and 32px. Tab onto a textarea in either engine, or onto a text
  input in WebKit, reveals only the caret; Chromium's Tab onto an input or select, and
  WebKit's onto a select, honour the margin. _Why:_ margins alone would fix only part of
  Tab and none of a tap, so the plan needed both halves (R-213's method). _Research:_
  R-224.
- **D-238-2 · Name, Contact, Religion and Notes get `scroll-clear-chrome`.** It is the
  room the unit field, the interest tiles and the Saved line already have (D-111-69,
  D-119-15), so a field lands at the bar's top. `globals.css` is unchanged. _Why:_ reuse,
  not a one-off (D-111-5, D-164-7); the utility already counts the home indicator.
- **D-238-3 · The record form brings an entry field taking focus into view, `nearest`
  and instantly, as a sheet's body does.** The `<form>`'s `onFocus` calls
  `scrollIntoView({ block: "nearest" })` on a target that `isEntryField`
  (`src/lib/whole-control.ts`) accepts: a textarea, a select, or an input that is not a
  radio or a checkbox. The offline shell draws the same form, so it has it too. Extends
  D-111-31 and D-136-3 to the page, with the page's fixed room rather than the bar as
  drawn (Known limits). _Why:_ only a scroll of our own brings a tapped field up
  (D-238-1). No button-like `<input>` exists in `src`, so none is excluded; one added
  later would count as a field.
- **D-238-4 · Only fields in the form's own DOM (`contains`).** React bubbles focus
  through portals, so the form also hears the docked Save, which `DockHost` portals out
  of it (D-111-20), and every sheet opened from it. Both are skipped. Applies D-214-9 to
  the page: a press on Save and next never moves the form. _Why:_ a sheet scrolls its own
  field once (D-111-31); without `contains` it was scrolled twice (builder bite).
- **D-238-5 · Tiles and buttons are never scrolled to.** A press on an interest tile,
  Save and next, Undo, See history or Add details moves the page as on main (0px). A
  sheet brings a tile whole (D-196-5); the page does not. _Why:_ the thumb is already on
  it, and the issue asked that nothing else on the page move. Known limit: at 28 and
  32px a tapped tile partly above the bar stays 74 or 88px under it, as on main.
- **D-238-6 · The unit field is included.** A tap on a unit field cut off at the top now
  moves the page 76px, to 56px below the top (the sync row's room); on main it stayed
  cut off. It never reaches the bar, as the page cannot scroll that far. After OK on Not
  saved it still lands under its label to the pixel: the form's `nearest` runs in the same
  task, before the dialog's own scroll (D-119-22). _Why:_ the same gap with the same fix.
- **D-238-7 · Tab onto a hidden field lands it at the bar's top, not centred.** In the
  browser, Tab from Religion left Notes 22 to 28px clear on main, centred by the browser;
  it now ends at 0. _Why:_ `nearest`, as in a sheet, and one rule for a tap and for Tab.
- **D-238-8 · Tests of behaviour, not class names.** `isEntryField`'s true and false
  cases. "a field taking focus" in `record-visit-form.test.tsx`: each of the five fields
  is scrolled once, `nearest`, on itself; Add details, a refused Save and High scroll
  nothing; a sheet's field is scrolled once, by the sheet. One E2E in
  `record-visit.spec.ts` taps Contact and Notes with their top 24px above the bar, first
  asserting each is under it, and expects 0. No class check (D-225-6) and no installed
  E2E (the inset is in the shared utility; D-230-4 already simulates it). Two existing
  tests set their spy after the unit is typed. Builder deviations from the plan:
  - The no-scroll test refuses Save for a missing interest level, not a blank unit: a
    blank unit opens Not saved, whose OK the dialog scrolls itself.
  - The E2E taps Contact and Notes, not Name, which is only 1px under on a Pixel 5.
  - The older-visits E2E taps Notes with `tapAboveTheBar`, not `click()`. Playwright's
    `click()` centres a hidden field first, and Chromium centres its margin box, so
    Notes' new margins moved it 44px higher and left Loading… under the nav. No member's
    tap is centred.

  _Why:_ jsdom lays nothing out (D-37-6), and each test failed with its part of the fix
  broken (builder and verifier bites). _Research:_ R-224.

- **D-238-9 · Other pages are left as a note.** Account's "Your name", above its docked
  "Save name", has no focus scroll. The inline forms with no docked bar (New session, Add
  member, sign-in) clear only the nav. _Why:_ the issue is the record page.

## How existing decisions are handled

Nothing is superseded. Two moves differ from main on purpose, against the issue's "nothing
else moves": D-238-6 and D-238-7.

| Decision           | Effect                                                                    | By      |
| ------------------ | ------------------------------------------------------------------------- | ------- |
| D-111-31, D-136-3  | Extended to the record page, with `scroll-clear-chrome`'s fixed room      | D-238-3 |
| D-214-9            | Applied to the page: the docked Save never moves the form                 | D-238-4 |
| D-196-5            | Not applied on the page: a tile is not scrolled to at all                 | D-238-5 |
| D-111-5, D-164-7   | Kept: the existing utility, no new one                                    | D-238-2 |
| D-111-69, D-117-77 | Unchanged: the Saved line and the unit field after a save, to the pixel   | -       |
| D-119-15, D-119-22 | Unchanged: OK on Not saved lands the unit field under its label           | D-238-6 |
| D-119-21           | Unchanged: a sheet opened from the form opens at its top, scrolls its own | D-238-4 |
| D-196-4, D-196-24  | Unchanged: the panel stays last; See history focuses a line, not a field  | -       |
| D-225-6, D-37-6    | Applied: no class-only check, one E2E                                     | D-238-8 |

## Evidence

- Planner, production build of main 610f95b, both phones, browser and installed (34px
  inset, R-218), 16, 28 and 32px, the fix injected at runtime: margins alone moved no
  tap; margins and the handler ended every tapped or tabbed details field at 0.
- Builder at c02d196: each bite failed exactly one test (`contains` removed, the type
  check removed, the scroll removed, a checkbox accepted). With the handler or the
  margins removed, the new E2E ends Contact at -24 on both phones.
- Verifier r1 at c02d196: Notes by tap and by Tab, 12 of 12 at 0 (main: -66 to -154 by
  tap; -229 and -236 by Tab, installed). Of 120 "nothing else moves" rows, 111 match
  main exactly; the other 9 differ only by a header that wrapped against a reseeded
  database. Admin, the offline shell and an offline record sent once also pass.

## Known limits

- With `scroll-clear-chrome`'s 80px, a field ends exactly at the bar's top, so its 2 to
  3px focus ring runs under the glass, where a sheet leaves 16px (D-136-3). The unit
  field after OK does the same on main.
- When the bar carries a failure or blocked note it is taller than 80px, so a focused
  field can still end under it, as the unit field and the Saved line already can.
- At 28 and 32px a tapped interest tile stays 74 or 88px under the bar (D-238-5).
- Not checked on a real installed iPhone with the keyboard up: our scroll runs at focus,
  before the keyboard's own. Nor the Religion picker on a phone, VoiceOver or TalkBack.
- Focus coming back to the app can scroll the page back to a focused field. The browser
  focuses it again, and React's `onFocus` hears that: a member who typed the unit,
  scrolled down to read the history and switched apps returns to the unit field. On main
  nothing moved. A sheet's body does the same (D-111-31). Not measured (reviewer).
- No test pins the margins on Name or Religion; dropping either alone passes every test
  (verifier nit 3).

## Follow-ups (owner)

- On a real installed iPhone: tap a partly showing Notes with the keyboard coming up,
  open Religion's picker, and switch apps with a field focused and scrolled away. If the
  page jumps back, the reviewer suggests skipping one refocus of the field that lost
  focus while the document did.
- Account's "Your name" and the inline forms (D-238-9).
- A WebKit flake in `large-text.spec.ts` ("the next unit holds still…", 32px):
  `pickMedium` clicks while the page still moves. Not #238's; an issue if it recurs
  (verifier nit 1).
- On main too: at 28px on an iPhone 13, "All units (43)" wraps its count onto a line of
  its own (verifier nit 4).

## Relies on

D-37-6, D-111-5, D-111-20, D-111-31, D-111-69, D-117-77, D-119-15, D-119-21, D-119-22,
D-136-3, D-164-7, D-196-4, D-196-5, D-196-24, D-214-9, D-225-6, D-230-4.

## Open questions

None.
