# #136 · Largest text: the Saved line, the next unit and a sheet's Send

- **Status:** Done (PR #191), with #181's large-text part. The owner approved D-136-1
  on 2026-11-15.
- **Phase:** 7 - Hardening
- **Depends on:** #111, #117, #119

## Task

At the 32px root, after a save in a follow-up session block with a dozen listed units,
the follow-up row beside Undo was set a word a line and pushed the unit field under the
docked Save. "Saved … on this phone." dropped the unit field 48px after "Sending…",
"Follow-up" broke at its hyphen, and at 320×568 Back to the list went under Save. On the
follow-up sheets, OK on Not saved left the note under the docked Send (D-119-33). Client
only: no contract or schema change.

## Decisions

- **D-136-1 · Every sheet's `SheetActions` bar is drawn at the 16px base (owner,
  2026-11-15).** It is `chrome-size` and `bleed-x`, as the page's docked Save is: 80px with
  Send at the base, in all ten sheets that use it. Extends D-111-60, which names only the
  nav, the docked Save and the sync row. _Why:_ at 32px on an iPhone 13 the bar was
  160px of a sheet whose header took 284px, so the note OK brought back started under
  Send. _Rejected:_ `chrome-size` on the button alone, as the bar's padding would still
  grow with the text.
- **D-136-2 · A bar's note on why its action is held back stays at the reader's size.**
  `SheetActions` takes it as `note`, with `noteId` for the action's `aria-describedby`,
  and draws it with the new `reader-size` utility (`--reader-size`), which restores
  `--reader-rem` inside `chrome-size`. That covers "Connect to change follow-ups", both
  team sheets' notes and Add households' blocker: 24px at 32px. _Why:_ this is content,
  which D-111-60 keeps at the text size. At the base size it was 12px at every size
  (verifier r1). _Rejected:_ putting the note in the body. In a tall sheet it scrolls
  away and leaves Send grey with no reason given.
- **D-136-3 · A sheet's body keeps a focused field clear of the bar as drawn.** The bar
  measures its height before paint, and again on every resize, onto its body as
  `--sheet-actions`. `scroll-clear-sheet-actions` is that height plus 16px, replacing
  `scroll-pb-24`. A sheet with no bar keeps only the 16px. Refines D-111-31. _Why:_ the
  bar is 80px, or 104 to 128px with a note, so a fixed padding left a field under the
  note. A `ResizeObserver` keeps the height current, so it does not go stale as D-111-40's
  measured offset did. _Refined by D-214-9:_ a control inside the bar is not scrolled
  to, since the padding counts the bar as covered and moved the form by its height.
- **D-136-4 · The Saved line keeps room for "Saved {unit} on this phone." from the save
  on (`hold-text`).** The held words come from `data-hold` as a `visibility: hidden`
  `::after` in the same grid cell, so they are in no text a test locator or screen reader
  reads. They are held only while nothing sits beside the words. Suggest, Add or Promote
  would be pushed onto a row of their own. _Why:_ at 32px the longer words wrapped one
  row taller just after Save, which dropped the unit field 48px. _Research:_ R-181.
  _Refined by D-196-2:_ under 18.75 reader-rems the offer has a held row of its own, so
  the words are held beside an offer too (`hold-text-narrow`). _Extended by D-196-22:_
  `hold-text` also holds the history line under the unit field.
- **D-136-5 · Non-breaking hyphens (U+2011) are used only in the held words.** The held
  copy is never drawn, copied or searched, so D-111-36's reason for rejecting them does
  not apply. The unit on screen stays in `UnitNumber`. Refines D-111-36. _Why:_ generated
  content has no element that can keep the unit on one line, so without them the hidden
  copy wraps where the visible one cannot. _Extended by D-196-2 and D-196-22:_ the held
  offer label and the history line's hold too (`unbroken()`).
- **D-136-6 · Undo follows the words it undoes, in their line.** The follow-up row is one
  paragraph: the marked-done text, then Undo inline on its baseline. The row is still
  there from "Sending…" on, and Undo is still at least 44×44 (`target-compact`,
  `min-w-11`). The button is shared, so admin Records gets the same Undo. Refines
  D-117-71. _Why:_ next to the words, at 32px Undo squeezed them to a word a line, 144 to
  330px tall.
- **D-136-7 · `WholeWords` keeps each hyphenated word in the marked-done text whole.** It
  sits in `unit-number.tsx` and passes every `\S+-\S+` through `UnitNumber`, including a
  server's reason, which may name a unit. It is used only in the Saved line's follow-up
  row and admin Records' marked line. _Why:_ "Follow-" over "up" read as two words. This
  is D-111-36's no-wrap, not a changed character. _Extended by D-196-6:_ the app's
  titles and labels that say "follow-up" too, so it is no longer used only here.
  _Refined by D-196-26:_ it holds each word with `whole-word`, an inline-block, not
  `UnitNumber`'s nowrap, so a word wider than its whole box breaks, at its hyphen first.
- **D-136-8 · `target-compact`: a text action's target is 44px, or on a short screen
  44px or one line of body text, whichever is more.** It is a new utility, and
  `control-compact` now applies it with the same values. Undo, Back to the list and the
  Saved line's offers use it: 48px at 32px, not `min-h-11`'s 88px. Extends D-111-48's
  short-screen switches, and targets stay at least 44px (D-30-8). _Why:_ an 88px target
  on each row under the line pushed the unit field under Save, and at 320×568 Back to the
  list too. _Extended by D-196-23:_ `leading-target` gives a line of words the same
  least, so See history is a whole target among them.
- **D-136-9 · The Saved line's rows touch and its sides are `px-2`, at every size.**
  `gap-x-2` replaces `gap-2` and `px-2` replaces `px-3`. _Why:_ each action already holds
  its own target's height, so a row gap was height taken from the field. With `px-3`,
  CI's DejaVu Sans set "Follow-up marked" a few px past one line, and about 8px is spare
  now. _Trade-off:_ at 16px, Undo's 44px target now touches Back to the list's directly
  below it, where there was 8px between them. A tap meant for one can land on the other,
  and Undo reopens a follow-up. _Not taken_ (reviewer, optional): a row gap held behind
  the `--short-by` clamp, as `space-under-tabs` does. _Research:_ R-182.
- **D-136-10 · At 320×568 and 32px, only Back to the list must be in view after a
  save.** When the line is taller than the room, it is aligned by its foot (R-89). The
  unit field, and with it the "Saved …" words and Undo, can then be out of view. At 16px
  the unit field is in view too. _Why:_ at the cap there is room for the line or for the
  next unit, never both. The way back to the list always fits.
- **D-136-11 · The `test.fail` naming #136 is gone, and every follow-up sheet is
  checked.** "OK brings the note back with its top edge in view" covers member Suggest
  and Edit suggestion, and admin Add to the follow-up list and Edit follow-up. It passes
  on both projects. Resolves D-119-33 and closes D-119-22's known limit. _Why:_ the owner
  added both the add and the edit sheets to #136, and Playwright fails a marked test that
  passes (R-107).
- **D-136-12 · `large-text.spec.ts` gains three more checks, and no new spec file.**
  - A save among a dozen listed doors at 32px: Undo, Back to the list and the unit field
    in view, no screen faults, and "Follow-up" on one line. Then at 320×568, Back to the
    list at 32px and 16px.
  - With the worker blocked, the unit field stays put from "Sending…" to "Saved … on this
    phone.".
  - Without signal, a sheet's note is 24px at 32px, and the body keeps the bar plus 16px.

  The eleven extra doors are seeded through the API in one `POST /visits/sync` batch
  and removed afterwards (D-37-7). The first send is held on a promise the test
  releases. Extends D-111-65. _Why:_ eleven direct saves used over a third of the admin's
  30-a-minute budget (D-126-8), so repeats were refused 429. A 1.5s timer let a slow run
  take both readings after the switch. That would pass with nothing held. _Extended by
  D-196-8 and D-196-15 (#196)._

- **D-136-13 · #181 part 2 stays open, and `:613` never failed CI.** In CI run
  43375997037, `:613` on mobile-webkit has outcome `expected`. Its body failed with
  "covered", as `test.fail` declared, and the run's two unexpected failures are both
  #181's. That corrects D-181's known limit, which reads the entry as a failure that
  "may mean its body passed". The test is now `:640`, with no mark. `:369`, now `:376`,
  passed 40 of 40 on macOS WebKit at `dff2daf`. #136 changes nothing it opens, so it
  exposes no cause. The PR says `Refs #181`. _Why:_ with no cause found, any change
  would be a guess or a wait (D-181-5). _Research:_ R-183. _See D-181-7:_ CI's trace
  later showed the cause, in the block screen's stand-in title.

### How existing decisions are handled

| Decision | Effect                                                                          | By                |
| -------- | ------------------------------------------------------------------------------- | ----------------- |
| D-111-60 | Extended to every sheet's `SheetActions`; its note keeps the text size (owner)  | D-136-1, D-136-2  |
| D-111-31 | Refined: `scroll-clear-sheet-actions` replaces `scroll-pb-24`                   | D-136-3           |
| D-111-36 | Refined: U+2011 only in hidden generated text; `WholeWords` beside `UnitNumber` | D-136-5, D-136-7  |
| D-111-53 | Kept; its line stays unheld for now (owner), though its reason no longer holds  | D-136-4           |
| D-111-40 | Kept: its marker is not measured; this measured height is kept current          | D-136-3           |
| D-111-48 | Extended: `target-compact` is a short-screen switch                             | D-136-8           |
| D-111-65 | Extended: a 12-door save at 32px and 320×568, and Sending to Saved on the phone | D-136-12          |
| D-117-71 | Refined: Undo inline after its words, still 44×44 and its own row               | D-136-6           |
| D-117-59 | Kept: the line keeps its height as the words change                             | D-136-4           |
| D-119-22 | Known limit closed: the note's top is above Send after OK                       | D-136-1, D-136-11 |
| D-119-33 | Resolved: the mark is gone, all four follow-up sheets checked                   | D-136-11          |
| D-30-8   | Kept: targets at least 44px                                                     | D-136-8           |
| D-181-5  | Kept: `:376` unchanged and open; the `:613` reading corrected                   | D-136-13          |

## Known limits

- **On an installed iPhone, a focused field in a sheet can end about 18px under the bar
  (reviewer r2 should-fix, open at `dff2daf`).** The bar sits above the body's
  `inset-safe-bottom` padding, while scroll padding is counted from the body's bottom
  edge. With a 34px inset, `--sheet-actions` plus 16px leaves the field 18px short.
  `scroll-clear-chrome` adds `env(safe-area-inset-bottom)` for the page. On main the
  shortfall was about 2px at 32px. Playwright draws no inset, so no E2E sees it.
  _Research:_ R-184. Accepted as a known limit (owner, 2026-11-15).
- Held words leave a blank line under "Saved #05-123." at 32px after a direct save that
  never says "on this phone" (48px above the unit). Where they cannot be held, "… Not
  sent." or a note's suffix can still grow the line. _Extended by D-196-2:_ under 18.75
  reader-rems, a direct save with an offer leaves it too, and a save that never sends
  keeps a blank offer row.
- ~~In a door-to-door session at 32px, the unit field drops 48px when the send lands and
  "Suggest a return visit" appears beside the words, since nothing is held then. On
  both engines the line grows from 114px to 162px. Main dropped it further. Filed as
  #196's item 2.~~ Closed by D-196-2 (#196): under 18.75 reader-rems the offer's row is
  held from the save on.
- ~~`WholeWords` covers only the marked-done text. Other "follow-up" words, such as the
  "Add to the follow-up list" and "Edit follow-up" sheet titles, can still break at the
  hyphen, and no check covers them.~~ Closed by D-196-6 and D-196-8 (#196); the words
  still unheld are in D-196's known limits.
- ~~In Add households at 32px on WebKit, a focused checkbox clears the bar but its tile
  runs about 64px under it. The scroll target is the input (D-119-22). Main was worse.~~
  Closed by D-196-5 (#196). The input was the target of D-111-31's focus scroll;
  D-119-22 is OK's scroll.
- Found outside #136 and not touched here; the PR should list them:
  - ~~On CI's Linux WebKit at 32px, "Record a visit" wraps before the session loads,
    against D-111-54.~~ Resolved by D-181-6 (#196's item 1).
  - ~~For #181: CI's screenshot of `:369` shows "Add details" never opened, with Save and
    next already live. This was not followed up.~~ Followed up in D-181-7: the session
    answered during the press, and the button moved out from under it.
- Not run on a real phone: Dynamic Type with SF metrics, a sheet with the software
  keyboard up, and VoiceOver on the live region. These are checks for the owner.

## Relies on

D-30-8, D-37-4, D-37-6, D-37-7, D-90-1, D-111-5, D-111-10, D-111-13, D-111-19, D-111-24,
D-111-34, D-111-36, D-111-48, D-111-60, D-111-65, D-117-59, D-117-71, D-119-22,
D-126-8, D-181-5.

## Open questions

None. The owner answered all four on 2026-11-15, taking each as this branch built it:

- **D-136-1:** every sheet's Send bar joins D-111-60's base-size chrome; its note still
  follows the text.
- **The held blank line (D-136-4):** kept. At 32px it costs 48px above the unit after a
  direct save, and keeps the unit still when a save is queued instead.
- **D-111-53's offline status line:** left unheld here. `hold-text` could hold it now,
  but that is for a later change.
- **Reviewer r2's should-fix** (a low field in a sheet ending about 18px under the
  docked Send on an installed iPhone): accepted as a known limit (Known limits).
