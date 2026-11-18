# #196 · Largest text: seven layout items left after #136

- **Status:** In progress (PR #217, branch `fix/196-200-largest-text`, with #200). The
  owner ruled Q1 and Q2 on 2026-11-18, then rulings 1 and 2 the same day (D-196-2,
  D-196-18). Two points are with the owner (Open questions).
  - The PR closes #196 only; #200 stays open (owner ruling 3).
  - The PR body and the squash message must say 18.75, not 21 (a0470ad's message says
    21), and must describe the history line.
- **Phase:** 7 - Hardening
- **Depends on:** #136, #160, #181

## Task

PR #191 (#136) left seven items at the 32px root:

1. a title that wraps on CI's Linux WebKit;
2. the unit field dropping 48px as a send lands;
3. admin Records' marked line landing under the nav;
4. the history panel pushing the interest picker down;
5. a focused tile running under a sheet's bar;
6. "follow-up" breaking at its hyphen outside the marked-done text;
7. a check that waits out its timeout.

Built with #200 in a0470ad, 45e1816 and f1d02d3, then the history line and `whole-word`
in 775137c, 6be1c93 and 5d85916. Client and E2E only: no contract or schema change.

## Decisions

- **D-196-1 · Item 1 is met by D-181-6, with no change.** The stand-in title is held to
  one line until the session answers, and `:904` guards it. `large-text.spec.ts` passed
  15 of 15 on Linux WebKit (DejaVu Sans) at a0470ad, 45e1816, f1d02d3, 6be1c93 and
  5d85916 (builder, verifier r0 to r2, fix-r0 and fix-r1). _Research:_ R-192, R-194.
- **D-196-2 · Under 18.75 reader-rems, the Saved line's offer has a row of its own from
  the save on, and the words are held. Wider, the offer sits beside the words and nothing
  is held (owner, Q1 (b) and ruling 1, 2026-11-18).**
  - The line is a container (`saved-line`).
  - Below the threshold, the offer's row (`offer-row`) is held at the offer's height by
    an unseen copy of its label (`offer-pending`) until the server has the visit.
  - The words take `hold-text-narrow` there.
  - `offerLabel(action, inFollowUpSession)` (`src/lib/follow-ups/rights.ts`) names the
    offer for both the held row and the button.

  Refines D-136-4 and closes its 48px known limit. _Why:_ the offer turned up as the send
  landed, and at 32px it dropped the unit field 48px. The line must not grow under a
  thumb (D-117-59, D-136-6).

  _Threshold (owner, ruling 1, 2026-11-18):_ 18.75 reader-rems. It supersedes the 21 of
  Q1 (b), ruled earlier that day. _Why:_ it is the widest pair in the system face, 18.71
  rems, rounded up. So at 16px from 360px wide, and at an iPhone's default 17px, the Saved
  line is as on main.
  - At 21, every save drew a blank held row on a 360px phone at 16px, and on 375pt and
    390pt iPhones at their default 17px, against Q1's "nothing changes at 16px".
  - 19 would still catch a 375pt iPhone at 17px (18.94 rems).
  - _Known limit:_ a face wider than the system face can still drop the offer unheld
    between 18.75 and about 20.7 rems, as on main (Known limits).

  _Research:_ R-201, R-202.

- **D-196-3 · Admin Records brings the marked line into view, clear of the nav, before
  paint.** The line gets `scroll-clear-nav`. A layout effect keyed on the marked visit id
  scrolls it (`block: "nearest"`). It runs once per record that marks something done, and
  never on Undo, which changes only the words. Extends D-117-76; follows D-111-69 and
  D-117-77. _Why:_ at 32px the line landed under the nav once the sheet had gone (y 622
  to 840 on main, with the nav at 600).
- **D-196-4 · The household history panel is the last thing in the recording form,
  after the interest picker and Add details (owner, Q2 (b), 2026-11-18; kept by ruling
  2).** With D-196-18, refines D-25-3: the panel is below everything a member taps, and
  a held line under the unit field says its key facts before knocking. It closes D-160's
  iPhone known limit, since an older page now lands below Notes. _Why:_ the panel lands
  once the unit's history is read. Above the picker, it pushed Medium down 1,494 to
  1,582px at 32px, under a thumb on its way there. _Not taken:_ (b'), under the picker,
  which still moves Add details, #181's failure. _Cost, answered by D-196-18:_ alone, it
  left 12px of the history above Save on an iPhone 13 at 16px and none at 17px, where
  main showed 236px and 222px. _Research:_ R-205.
- **D-196-5 · In a sheet, a focused input drawn inside its label brings the whole label
  tile into view (`wholeControl`, `src/lib/whole-control.ts`).** The sheet body's focus
  scroll (D-111-31) now scrolls `wholeControl(event.target)`.
  - It reaches the tiles of the interest picker (Record for a member, Amend), the
    household picker (Add households) and Also add.
  - It does not reach New session's picker. `CreateSessionForm` is drawn inline on
    `/admin/sessions`, not in a sheet. Its focused tile is already clear of the nav at
    32px (y 288 to 432, nav at 600; verifier).

  Refines D-111-31, and applies D-119-22's label rule to focus. Closes D-136's Add
  households limit. _Why:_ WebKit scrolled only the box, which left the tile's foot 64px
  under the bar. _Research:_ R-204.

- **D-196-6 · "follow-up" stays whole in the app's own titles and labels.** `WholeWords`
  now also wraps:
  - the follow-up, promote and remove sheet titles, and `HintCard`'s title;
  - the Follow-up list page title (`PageHeader.title` is now a node);
  - the "Follow-up session" label, in the block's notice and on the session screen;
  - `ADD_TO_LIST` and `ON_THE_LIST` wherever they are drawn: the Saved line's offer,
    `PromoteButton`, the history panel's anchor and caption (D-196-9), the unit screen
    (D-196-10) and the history line (D-196-18).

  Every one is an app constant. Running sentences, typed text and the words in Known
  limits keep ordinary breaks. Extends D-136-7. _Refined by D-196-26:_ held with
  `whole-word`, not `UnitNumber`'s nowrap, so a word wider than its line breaks. _Why:_
  "Follow-" over "up" reads as two words in a title. Holding typed text, or a word wider
  than the line, would push the screen sideways.

- **D-196-7 · `expectOnOneLine` asserts one element, then counts the distinct tops of a
  Range over its contents.** _Why:_ a word that is no longer held is no longer an
  element, so the check fails within the 10s expect timeout. The 12-door test's `finally`
  then still removes its 22 notes (verifier, both projects). A Range gives each line of
  the text, which an element's own boxes, or a change of display, would hide. Since
  D-196-26 the held word is an inline-block, one box however many lines it takes, so
  only the Range can count them. _Research:_ R-203.
- **D-196-8 · Each fixed item is checked by extending an existing `large-text.spec.ts`
  test, at the 32px root on both phone projects. No spec file is added.**
  - `:904`: Medium and Add details hold still as the history lands (item 4).
  - The follow-up sweep: it focuses the last box in Add households (item 5) and records
    for a member in admin Records (item 3).
  - The sheet and page-title checks use `expectOnOneLine` (items 6 and 7).
  - "after Save and next": the send is held, and the unit field is measured as Suggest
    turns up (item 2).

  Each check failed with its fix reverted (builder, verifier r0 to r2). Item 5's failed
  on WebKit only, as Chromium's own focus scroll already clears the tile. Extends
  D-111-65, D-136-12 and D-181-8. _Why:_ this is the issue's criterion, and the suite is
  kept thin (D-37-6). _Extended by D-196-27:_ the history line and `whole-word`.

- **D-196-9 · The history panel's "On the follow-up list" caption draws `ON_THE_LIST`,
  held whole.** It was a literal of the same words. _Why:_ at 32px it broke at the
  hyphen too.
- **D-196-10 · On the unit screen, `ON_THE_LIST` is wrapped in a single span inside its
  `inline-flex` paragraph, and `waitingLabel(by)` is left breakable.** _Why:_ each of
  `WholeWords`' runs would otherwise be a flex item, and the spaces between them would
  drop (the trap `FollowUpDoor` notes). The waiting label names a member, which is typed
  text.
- **D-196-11 · The offer row is `flex`, and the pending child carries no display
  utility.** _Why:_ as a flex item, the child takes `target-compact`'s height, which an
  inline span ignores. A display class on it would override `offer-pending`'s `display:
none` where the offer sits beside the words.
- **D-196-12 · `wholeControl` acts on an `<input>` only.** A textarea or select inside
  its label scrolls itself. _Why:_ those are what a member types or picks in, and they
  can be taller than a tile.
- **D-196-13 · Item 5's check compares the tile's box with the bar, which is the sheet
  body's last child. It does not use `expectInView`.** _Why:_ `expectInView`'s 2px
  corner hit test lands outside the list's rounded `overflow-hidden` clip, on the sheet.
- **D-196-14 · Each held answer gets a fresh route and promise (`holdBack` in `:904`,
  `holdSend` in "after Save and next"). `holdSend` holds only a batch that contains the
  unit under test.**
  - A released promise lets every later request through.
  - The queue's own retry of the earlier offline saves could go out first. Held, it kept
    the run open, so the save under test never showed as sending and the test waited out
    its timeout. An `online` event reproduced this on both projects, and f1d02d3 fixes
    it.

  Follows D-37-4: no waits or retries.

- **D-196-15 · "after Save and next" also sends a held save at 16px with the screen
  360px wide. The line must stay one row (`pastOneRow`) while it sends and once Suggest
  shows.** _Why:_ both test phones are 21.25 rems or wider at 16px, so at device width
  nothing would catch the threshold going back to 21. At 360px that change fails on both
  projects, 22px past one row.
- **D-196-16 · The E2E now stores visits that it does not remove.** These are
  idempotent (D-37-7).
  - "after Save and next" stores #86-01 to #86-05 in each project. Before, every sync was
    aborted.
  - The follow-up sweep stores an admin-recorded Medium visit for Alice at #05-123. Undo
    reopens its note, but the visit stays.

  _Why:_ the send must land for the offer to show, and only a record marks a note done.
  `listSeededHousehold` lists #05-123 again, and the E2E database is truncated each run
  (D-37-4).

- **D-196-17 · Record for a member picks Alice by her seed id (`SEED_MEMBER_ID`, now in
  `e2e/accounts.ts`), not her name.** _Why:_ another spec may rename her.

### The history line (owner, ruling 2, 2026-11-18)

- **D-196-18 · A held line under the unit field (`#unit-history`) says the unit's
  history in one line and leads down to the panel.**
  - The owner approved its words: "On the follow-up list · Overdue · 3 visits · See
    history", and "No earlier visits" for a unit with nothing recorded.
  - It sits after the unit field's error and gate lines, and before #200's notice
    (D-200-1). The panel stays last (D-196-4).
  - `historySummary` and `historyLine` are in `src/lib/households/history-summary.ts`.

  With D-196-4, refines D-25-3, which holds again at the default text. On an iPhone 13
  and a Pixel 5 at 16px and 17px the whole line is above the docked Save, unscrolled, and
  nothing moves as the history lands (verifier fix-r1). _Why:_ with the panel last, none
  of the history, an Overdue note included, showed above Save on an iPhone 13 at 17px
  (verifier r2). _Research:_ R-205, R-206.

- **D-196-19 · The line has five states:** the summary; "Checking this unit's history…"
  while it is read; "Could not read this unit's history." when it cannot be; "No earlier
  visits"; and blank. Save never waits on it, as D-25-3's lookup never blocks. _Why:_ it
  says only what is known, and a failed read is not an empty history.
- **D-196-20 · The summary follows the panel's rules.** The first part is "On the
  follow-up list" for a listed note still owed, else "Waiting for review" for a waiting
  suggestion. Overdue counts owed notes only (D-117-6), past their day (D-35-4) as of
  when the history landed. The count is `pagination.total` (D-160-1), and `visitCount`
  has no "none" case. _Why:_ the line and the panel must agree. The panel reads one page,
  so only the total counts every visit. A household is created by its first visit and
  visits are never deleted, so an unreachable branch is deleted rather than tested.
- **D-196-21 · "No earlier visits" only once a whole read of the block's units has
  landed (`unitsRead`, `known !== null` on the block screen) and nothing for the unit is
  held on the phone, sent or not. Otherwise the line is blank.** `unitsRead` is never set
  in the offline shell. _Why:_ a unit missing from a partial read, from the shell's copy,
  which may be hours old, or from a read older than this phone's own save, has history.
- **D-196-22 · The line is held from the moment a unit the form would save is typed, at
  `LONGEST_SUMMARY`: "On the follow-up list · Overdue · 99 visits · See history".** It is
  set in one weight, medium, with tabular figures. Overdue keeps its word and danger
  colour (D-35-5, D-111-10) but is no longer semibold. Extends D-136-4's `hold-text` and
  D-136-5's `unbroken()` to the line. _Why:_ nothing below moves as it lands.
  - The held `::after` copy has one weight. A semibold Overdue outgrew a medium hold by
    about 1px, and a semibold hold took two rows on a 375pt iPhone at 17px.
  - "99 visits" is the widest count a unit realistically reaches. In tabular figures,
    every two-figure count is that wide.
  - The first hold, "No visits yet", can never show, and held two rows where the words
    take one (verifier fix-r0).

  _Research:_ R-206.

- **D-196-23 · `leading-target`: lines as tall as a tap target, with what is set among
  the words aligned to their top.** A line is 44px or 1.5 reader-rems, whichever is
  more: `target-compact`'s least (D-136-8). The history line uses it, so See history is
  a whole target inline: 66×44 at 16px, 122×48 at 32px. Extends D-136-8 and keeps D-30-8.
  _Why:_ a text action then grows no line, so `hold-text` can hold it. On its baseline, a
  word in another weight made WebKit's line 1/64px taller than its held words at 32px.
  _Research:_ R-208.
- **D-196-24 · See history calls the panel's `show()` (`HistoryPanelHandle`).** The
  panel's top scrolls clear of the pinned chrome (`scroll-clear-chrome`, as D-111-69),
  and focus goes to its first line, the household's name. Only that line takes
  `tabIndex -1`, and only at the door. The URL does not change. _Why:_ with the panel
  focusable (775137c), a WebKit tap on any button in it focused the panel and scrolled
  the page to it. "Could not load earlier visits." then sat under the docked Save
  (`record-visit.spec.ts:998`; fixed in 6be1c93). _Research:_ R-207.
- **D-196-25 · The line is a polite, atomic live region.** _Why:_ it changes as the
  history is read, with no tap, and each state reads whole.

### `WholeWords` and the checks

- **D-196-26 · `WholeWords` holds each hyphenated word with `whole-word`, not
  `UnitNumber`'s nowrap.** `whole-word` is an inline-block with `max-width: 100%`,
  `overflow-wrap: break-word` and inherited decoration. A word goes whole onto the next
  line where it fits on one, and breaks inside, at its hyphen first, only where it alone
  is wider than its box. Refines D-136-7, which passed the words through `UnitNumber`.
  `UnitNumber` is unchanged. _Why:_ nowrap ran "follow-ups?" 16px out of the "What are
  follow-ups?" hint at 320px and 32px in DejaVu Sans. It now breaks there, as "follow-"
  over "ups?". An inline-block takes no underline from its action, so it inherits one.
  _Research:_ R-208.
  - _Narrows D-111-36 (owner to confirm, Open questions):_ a unit number in `WholeWords`
    text, such as a server's reason, can now break at its hyphen where it alone is wider
    than its box. Before, it ran out of the box.
- **D-196-27 · `:904` checks the line, and "a member's screens fit" checks the Follow-ups
  hint at 320px.**
  - `:904` gains a door-to-door pass at the phone's own width, at 16px, 17px and 32px.
    The line, Medium and Add details hold still as the history lands, and See history's
    target is `max(44px, 1.5 × root)`.
  - At 16px and 17px the page is unscrolled, and the line is in view and 44px tall, with
    Low, Medium and High in view above Save.
  - The follow-up pass checks the line holds still too.

  Extends D-196-8 and D-181-8. _Why:_ a hold one row too tall took the picker under Save
  on an iPhone at 17px. The hint check bites only in DejaVu, CI's face: the system face
  has 18px to spare there.

- **D-196-28 · `layoutFaults` measures a line of text against its nearest non-inline
  box.** Refines D-111-37's spill check. _Why:_ an inline box goes wherever its words go,
  so measured against itself a held word never spills. The old measure passed with
  "follow-ups?" 16px out of its card (verifier fix-r0). _Research:_ R-208.

### How existing decisions are handled

| Decision                     | Effect                                                                        | By                          |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| D-181-6                      | Applied: meets item 1                                                         | D-196-1                     |
| D-136-4                      | Refined: under 18.75 rems the words are held beside an offer too              | D-196-2                     |
| D-136-4, D-136-5             | Extended: `hold-text` and `unbroken()` hold the history line too              | D-196-22                    |
| D-136-5                      | Extended: U+2011 in the held offer label too (`unbroken()`)                   | D-196-2                     |
| D-136 limit, held blank line | Extended: a direct save with an offer, under 18.75 rems                       | D-196-2                     |
| D-136 limits, items 2, 5, 6  | Closed                                                                        | D-196-2, D-196-5, D-196-6   |
| D-117-59, D-136-6            | Followed: the line keeps its height                                           | D-196-2                     |
| D-30-8                       | Kept at 16px: Suggest 158×44, Add to follow-up list 149×44, See history 66×44 | D-196-2, D-196-23           |
| D-111-60, R-75               | Exact only from a 16px root to 32px (R-202)                                   | D-196-2                     |
| D-117-76                     | Extended: the marked line is scrolled into view before paint                  | D-196-3                     |
| D-111-69, D-117-77           | Pattern followed                                                              | D-196-3, D-196-24           |
| D-25-3                       | Refined (owner): the panel is last, and a held line says its key facts first  | D-196-4, D-196-18           |
| D-160 limit, iPhone          | Closed: older pages land below Notes                                          | D-196-4                     |
| D-160-17                     | Kept: the failure line still lands in view above Save at 32px                 | D-196-4                     |
| D-160-1                      | Applied: the count is `pagination.total`; notes are whole on every page       | D-196-20                    |
| D-117-6, D-35-4              | Followed: Overdue counts listed notes still owed, past their day              | D-196-20                    |
| D-35-5, D-111-10             | Kept: the word Overdue, in the danger colour, now in medium                   | D-196-22                    |
| D-136-8                      | Extended: `leading-target` takes its least                                    | D-196-23                    |
| D-200-1                      | Kept: the notice is still under the unit field, after the line                | D-196-18                    |
| D-155-2                      | Followed: the history's answer and failure are set in `startTransition`       | D-196-19                    |
| D-111-31                     | Refined: a box drawn in its label tile brings the tile                        | D-196-5                     |
| D-119-22                     | Extended: its label rule applies to the focus scroll                          | D-196-5                     |
| D-136-7                      | Extended: the app's titles and labels; refined: `whole-word`, not nowrap      | D-196-6, D-196-26           |
| D-111-36                     | `UnitNumber` kept; narrowed in `WholeWords` text (owner to confirm)           | D-196-26                    |
| D-111-37                     | Refined: a spill is measured against the nearest non-inline box               | D-196-28                    |
| D-111-65, D-136-12, D-181-8  | Extended                                                                      | D-196-8, D-196-15, D-196-27 |
| D-37-4, D-37-7               | Followed: no waits or retries; new stored data is idempotent                  | D-196-14, D-196-16          |

## Evidence

- **Bites, items 1 to 7** (each fix reverted, then restored; verifier r2, both projects
  unless noted):
  - #200's notice above the tabs: `:904` saw the unit field move from y 338 to 540.
  - Item 2 off: the next unit moved from y 256 to 306. With the threshold at 21, the
    line ran 22px past one row at 16px and 360px.
  - Item 3: the marked line was out of view.
  - Item 4: Medium moved from y 1134 to 3044 (Chromium) and 3164 (WebKit).
  - Item 5: the tile's foot was 64px under the bar, on WebKit only.
  - Items 6 and 7: each check failed fast on `toHaveCount(1)`, in 11 to 18s, and all 22
    listed notes were removed afterwards.

  Vitest bit too: 11 tests across the three builds.

- **Bites, the line and `whole-word`** (verifier fix-r0 and fix-r1, both projects unless
  noted):
  - The line unheld: at 32px it grew from 48 to 96px, and Medium moved 48px.
  - `leading-target` removed: See history's target was 16px, not 44.
  - The hold back to "No visits yet" in semibold: the line was 88px at 17px, not 44.
  - The line moved to the end of the form: `:904` failed on WebKit; Chromium passed
    (Known limits), and Vitest failed.
  - `WholeWords` back to nowrap, with DejaVu injected into the 320px check: "follow-ups?"
    spilled out of its box. With `layoutFaults` measured the old way, it passed.
  - See history focusing the panel, `tabular-nums` removed, Overdue in semibold, "No
    earlier visits" whatever the units or the queue say, and a done note counted as
    owed: each failed in Vitest.
- **Gates** at 5d85916: lint, typecheck, format and `test:coverage` (282 files, 5,017
  tests, thresholds met; builder r3). The native E2E passed 185, with 7 skipped
  (verifier fix-r1). Linux WebKit passed `large-text.spec.ts` 15 of 15
  (`linux-196-builder-4.log`, `linux-196-verifier-2.log`).
- **Signing:** a0470ad, 45e1816 and 5d85916 are unsigned, as the owner allowed; f1d02d3,
  775137c and 6be1c93 are signed.

## Known limits

- **At 320px and 16px, the Saved line is held at 78px from the save on.** At 16.9 rems it
  keeps a blank row while it waits to send. Main started at 56px and grew to 78px,
  moving the unit field 22px; the branch moves it 0.
- **A face wider than the system face can still drop the offer unheld.** The widest pair
  needs 20.68 rems in DejaVu Sans, so between 18.75 and about 20.7 rems it drops, as on
  main. With #12-1234A, verifier r1 measured 22px at 360 and 375px. The same holds in any
  phone face wider than SF Pro or Roboto. CI's own unit, #86-04, fits beside Suggest at
  360px in DejaVu, with about 10px to spare.
- **A unit wider than #12-1234A** can still push the offer onto a row of its own,
  unheld, at 18.75 rems or wider.
- **Below a 16px root** (iOS's smaller sizes), the text stays at 16px, but the query
  measures in the root's smaller rem. At a 14px root on a 320pt screen, the line reads as
  19.29 rems wide and takes the wide layout, though the pair needs 299 of its 270px. The
  offer then drops the field 22px, as on main (R-202). The comment above the queries in
  `globals.css` says so since 775137c.
- **Held blank rows.**
  - Under 18.75 rems, D-136's held blank line now also follows a direct save with an
    offer.
  - A queued save that never sends (the offline shell, held or quarantined) keeps a blank
    offer row under its words.
  - At 32px the Saved line is a row or two taller than main's from Sending on, as ruled
    for (b).
- **The admin's offer holds a taller line from 19px up.** "Add to follow-up list" is
  narrower than Suggest, but it takes the same threshold, so after the send a blank row
  sits between the words and the offer. Line heights, main against the branch:

  | Root | Main, sending to sent | Branch, held |
  | ---- | --------------------- | ------------ |
  | 19px | 66.5 to 66.5px        | 92.25px      |
  | 28px | 100 to 102px          | 144px        |
  | 32px | 114 to 114px          | 162px        |

  This is the same on both engines, add and promote alike. At 19px and 32px main never
  moved, so the height buys nothing there. At 32px the next unit sits 48px lower, still
  in view (verifier r2).

- **The history line (D-196-18 to D-196-25):**
  - **Its held row costs 44px at every door, "No earlier visits" included** (Open
    questions).
  - At 360px and 17px the hold takes two rows in the system face. In DejaVu it takes two
    at 360px and 16px, where its words take one. Roboto, the face of most 360px phones,
    was not measured.
  - A unit with 100 or more visits is one figure wider than the hold: 7.8px at 16px.
    Where the line has less to spare, such as a 375pt iPhone at 17px, it takes a second
    row as the history lands and moves the picker down.
  - At 32px the line is held two or three rows tall at every door, mostly blank under
    "No earlier visits". See history is under Save on an iPhone 13, and at 320×568 the
    whole line is.
  - It appears at the first keystroke, and says "No earlier visits" for partial input
    ("#", "#05-12"). The picker drops 44px as it appears, while the member types, and a
    screen reader announces it.
  - "No earlier visits" is only as fresh as the block's last whole read. Offline on the
    live page, or after a teammate's visit since that read, it can be stale.
  - On Chromium, `:904` misses the line moved to the end of the form, since a Pixel 5
    has room for it above Save. WebKit and Vitest catch it.
- **The history panel needs a scroll** at large text, and on an iPhone 13 at 16px and
  17px. Its key facts are in the line (D-196-18).
- **"follow-up" still breaks** in these places:
  - `admin-sessions.tsx`'s "Follow-up list" shortcut, a flex `Link` that would need a
    wrapping span;
  - the one-word title "Follow-ups", which is wider than a 320px line at 32px in DejaVu;
  - "What are follow-ups?" at 320px and 32px in DejaVu, at its hyphen (D-196-26);
  - the unit list's "1 follow-up outstanding";
  - `waitingLabel`, which names a member.
- **Not run:**
  - the 16px and 17px checks (D-196-15, D-196-27) on Linux Chromium; the Linux exception
    covered `mobile-webkit` only. In DejaVu a Pixel 5 at 17px leaves about 7.6px to
    spare. The publish step's full Linux run is their first there;
  - a real iPhone with Dynamic Type;
  - the offline shell's held row on WebKit (D-32-18), and its blank history line
    outside Vitest.

## Relies on

D-25-3, D-30-8, D-35-4, D-35-5, D-37-4, D-37-6, D-37-7, D-111-5, D-111-10, D-111-31,
D-111-36, D-111-37, D-111-60, D-111-65, D-111-69, D-117-6, D-117-59, D-117-76, D-117-77,
D-119-22, D-136-4, D-136-5, D-136-6, D-136-7, D-136-8, D-136-12, D-155-2, D-160-1,
D-160-17, D-181-6, D-181-8, D-200-1.

## Open questions

- **The history line's held row (D-196-18, D-196-22).** It costs 44px at every door,
  including "No earlier visits", which most doors in a new block show and where main
  showed nothing. After Save and next, at a new unit, this much of Medium is above the
  docked Save:

  | Phone, root     | Before the line (f1d02d3) | 5d85916    |
  | --------------- | ------------------------- | ---------- |
  | iPhone 13, 16px | 56 of 56px                | 28 of 56px |
  | iPhone 13, 17px | 48 of 60px                | 4 of 60px  |
  | 360×640, 16px   | 48 of 56px                | 4 of 56px  |
  | Pixel 5         | all                       | all        |

  No accepted decision is contradicted, but the owner has not seen this cost. Builder
  r3's options:
  - (a) accept it as a known limit;
  - (b) "No earlier visits" at text height, giving back about 24px where nothing is
    recorded; the line then grows while a known unit is typed, with no tap in flight;
  - (c) no line where nothing is recorded, against the approved wording.

- **D-196-26 against D-111-36 ("A unit number is never split").** In `WholeWords` text, a
  unit number now breaks at its hyphen where it alone is wider than its box; before, it
  ran out of the box. A unit may be 32 characters long; a usual one, such as #05-123, is
  far narrower than a line at 32px. Elsewhere `UnitNumber` is unchanged. Confirm the
  narrowing, or keep unit numbers in `WholeWords` text on nowrap.
