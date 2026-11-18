# #196 · Largest text: seven layout items left after #136

- **Status:** In progress (branch `fix/196-200-largest-text`, with #200; not yet a PR).
  The owner ruled Q1 and Q2 on 2026-11-18. Two points are back with the owner (Open
  questions).
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

Built with #200 in a0470ad, 45e1816 and f1d02d3. Client and E2E only: no contract or
schema change.

## Decisions

- **D-196-1 · Item 1 is met by D-181-6, with no change.** The stand-in title is held to
  one line until the session answers, and `:888` guards it. `large-text.spec.ts` passed
  15 of 15 on Linux WebKit (DejaVu Sans) at a0470ad, 45e1816 and f1d02d3 (builder,
  verifier r0 to r2). _Research:_ R-192, R-194.
- **D-196-2 · Under 18.75 reader-rems, the Saved line's offer has a row of its own from
  the save on, and the words are held. Wider, the offer sits beside the words and nothing
  is held (owner, Q1 (b), 2026-11-18).**
  - The line is a container (`saved-line`).
  - Below the threshold, the offer's row (`offer-row`) is held at the offer's height by
    an unseen copy of its label (`offer-pending`) until the server has the visit.
  - The words take `hold-text-narrow` there.
  - `offerLabel(action, inFollowUpSession)` (`src/lib/follow-ups/rights.ts`) names the
    offer for both the held row and the button.

  Refines D-136-4 and closes its 48px known limit. _Why:_ the offer turned up as the send
  landed, and at 32px it dropped the unit field 48px. The line must not grow under a
  thumb (D-117-59, D-136-6).

  _Threshold:_ 18.75, not the 21 the owner ruled (Open questions).
  - At 21, every save drew a blank held row on a 360px phone at 16px, and on 375pt and
    390pt iPhones at their default 17px. That broke the ruling's other clause, "nothing
    changes at 16px".
  - 18.75 is the widest pair in the system face, 18.71 rems, rounded up to a quarter.
  - 19 would still catch a 375pt iPhone at 17px (18.94 rems).

  _Research:_ R-201, R-202.

- **D-196-3 · Admin Records brings the marked line into view, clear of the nav, before
  paint.** The line gets `scroll-clear-nav`. A layout effect keyed on the marked visit id
  scrolls it (`block: "nearest"`). It runs once per record that marks something done, and
  never on Undo, which changes only the words. Extends D-117-76; follows D-111-69 and
  D-117-77. _Why:_ at 32px the line landed under the nav once the sheet had gone (y 622
  to 840 on main, with the nav at 600).
- **D-196-4 · The household history panel is the last thing in the recording form,
  after the interest picker and Add details (owner, Q2 (b), 2026-11-18).** Refines
  D-25-3: the history is still on the form before saving, but below everything a member
  taps. It closes D-160's iPhone known limit, since an older page now lands below Notes.
  _Why:_ the panel lands once the unit's history is read. Above the picker, it pushed
  Medium down 1,494 to 1,582px at 32px, under a thumb on its way there. _Not taken:_
  (b'), under the picker, which still moves Add details, #181's failure. _Cost:_ on an
  iPhone 13 at 16px and 17px, little or none of the history shows above Save (Open
  questions). _Research:_ R-205.
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
  (unchanged) now also wraps:
  - the follow-up, promote and remove sheet titles, and `HintCard`'s title;
  - the Follow-up list page title (`PageHeader.title` is now a node);
  - the "Follow-up session" label, in the block's notice and on the session screen;
  - `ADD_TO_LIST` and `ON_THE_LIST` wherever they are drawn: the Saved line's offer,
    `PromoteButton`, the history panel's anchor and caption (D-196-9), and the unit
    screen (D-196-10).

  Every one is an app constant. Running sentences, typed text and the words in Known
  limits keep ordinary breaks. Extends D-136-7; D-111-36 is unchanged. _Why:_ "Follow-"
  over "up" reads as two words in a title. Holding typed text, or a word wider than the
  line, would push the screen sideways.

- **D-196-7 · `expectOnOneLine` asserts one element, then counts the distinct tops of a
  Range over its contents.** _Why:_ a word that is no longer held is no longer an
  element, so the check fails within the 10s expect timeout. The 12-door test's `finally`
  then still removes its 22 notes (verifier, both projects). A Range gives each line of
  the text, which an element's own boxes, or a change of display, would hide.
  _Research:_ R-203.
- **D-196-8 · Each fixed item is checked by extending an existing `large-text.spec.ts`
  test, at the 32px root on both phone projects. No spec file is added.**
  - `:888`: Medium and Add details hold still as the history lands (item 4).
  - The follow-up sweep: it focuses the last box in Add households (item 5) and records
    for a member in admin Records (item 3).
  - The sheet and page-title checks use `expectOnOneLine` (items 6 and 7).
  - "after Save and next": the send is held, and the unit field is measured as Suggest
    turns up (item 2).

  Each check failed with its fix reverted (builder, verifier r0 to r2). Item 5's failed
  on WebKit only, as Chromium's own focus scroll already clears the tile. Extends
  D-111-65, D-136-12 and D-181-8. _Why:_ this is the issue's criterion, and the suite is
  kept thin (D-37-6).

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
- **D-196-14 · Each held answer gets a fresh route and promise (`holdBack` in `:888`,
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

- **D-196-17 · Record for a member picks Alice by her seed id (`SEED_MEMBER_ID`), not her
  name.** _Why:_ another spec may rename her.

### How existing decisions are handled

| Decision                     | Effect                                                                    | By                        |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| D-181-6                      | Applied: meets item 1                                                     | D-196-1                   |
| D-136-4                      | Refined: under 18.75 rems the words are held beside an offer too          | D-196-2                   |
| D-136-5                      | Extended: U+2011 in the held offer label too (`unbroken()`)               | D-196-2                   |
| D-136 limit, held blank line | Extended: a direct save with an offer, under 18.75 rems                   | D-196-2                   |
| D-136 limits, items 2, 5, 6  | Closed                                                                    | D-196-2, D-196-5, D-196-6 |
| D-117-59, D-136-6            | Followed: the line keeps its height                                       | D-196-2                   |
| D-30-8                       | Kept: Suggest is 158×44 at 16px, Add to follow-up list 149×44             | D-196-2                   |
| D-111-60, R-75               | Exact only from a 16px root to 32px (R-202)                               | D-196-2                   |
| D-117-76                     | Extended: the marked line is scrolled into view before paint              | D-196-3                   |
| D-111-69, D-117-77           | Pattern followed                                                          | D-196-3                   |
| D-25-3                       | Refined (owner): the history is after the picker; its iPhone cost is open | D-196-4                   |
| D-160 limit, iPhone          | Closed: older pages land below Notes                                      | D-196-4                   |
| D-160-17                     | Kept: the failure line still lands in view above Save at 32px             | D-196-4                   |
| D-111-31                     | Refined: a box drawn in its label tile brings the tile                    | D-196-5                   |
| D-119-22                     | Extended: its label rule applies to the focus scroll                      | D-196-5                   |
| D-136-7                      | Extended: the app's titles and labels too                                 | D-196-6                   |
| D-111-36                     | Kept: typed text and running sentences break as before                    | D-196-6                   |
| D-111-65, D-136-12, D-181-8  | Extended                                                                  | D-196-8, D-196-15         |
| D-37-4, D-37-7               | Followed: no waits or retries; new stored data is idempotent              | D-196-14, D-196-16        |

## Evidence

- **Bites** (each fix reverted, then restored; verifier r2, both projects unless noted):
  - #200's notice above the tabs: `:888` saw the unit field move from y 338 to 540.
  - Item 2 off: the next unit moved from y 256 to 306. With the threshold at 21, the
    line ran 22px past one row at 16px and 360px.
  - Item 3: the marked line was out of view.
  - Item 4: Medium moved from y 1134 to 3044 (Chromium) and 3164 (WebKit).
  - Item 5: the tile's foot was 64px under the bar, on WebKit only.
  - Items 6 and 7: each check failed fast on `toHaveCount(1)`, in 11 to 18s, and all 22
    listed notes were removed afterwards.

  Vitest bit too: 11 tests across the three builds.

- **Gates** at f1d02d3: lint, typecheck, format and `test:coverage` (4,988 tests,
  thresholds met). The native E2E passed 185, with 7 skipped. Linux WebKit passed
  `large-text.spec.ts` 15 of 15.

## Known limits

- **At 320px and 16px, the line is held at 78px from the save on.** At 16.9 rems it
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
  `globals.css` still says "A container query's rem is the reader's". A reviewer asked
  for "the root's, which is the reader's from 16px to 32px"; it is not changed at
  f1d02d3.
- **Held blank rows.**
  - Under 18.75 rems, D-136's held blank line now also follows a direct save with an
    offer.
  - A queued save that never sends (the offline shell, held or quarantined) keeps a blank
    offer row under its words.
  - At 32px the line is a row or two taller than main's from Sending on, as ruled for
    (b).
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

- **The history needs a scroll** at large text, and on an iPhone 13 at the base and
  default sizes (Open questions).
- **"follow-up" still breaks** in these places:
  - `admin-sessions.tsx`'s "Follow-up list" shortcut, a flex `Link` that would need a
    wrapping span;
  - the one-word title "Follow-ups", which is wider than a 320px line at 32px in DejaVu;
  - the unit list's "1 follow-up outstanding";
  - `waitingLabel`, which names a member.
- **Not run:**
  - the 16px check on Linux Chromium; the Linux exception covered `mobile-webkit` only;
  - a real iPhone with Dynamic Type;
  - the offline shell's held row on WebKit (D-32-18).

## Relies on

D-25-3, D-30-8, D-37-4, D-37-6, D-37-7, D-111-5, D-111-10, D-111-31, D-111-36, D-111-60,
D-111-65, D-111-69, D-117-59, D-117-76, D-117-77, D-119-22, D-136-4, D-136-5, D-136-6,
D-136-7, D-136-12, D-160-17, D-181-6, D-181-8.

## Open questions

- **The threshold (D-196-2).** The owner ruled (b) "only below 21 reader-rems, nothing
  changes at 16px". Below 386px those two clauses cannot both hold, so the build keeps
  the second and uses 18.75 (builder r1, verifier r1). Confirm 18.75 before merge. The
  message of a0470ad still says 21; the PR body and the squash message must say 18.75.
- **What the history costs on an iPhone (D-196-4 against D-25-3).** D-25-3 says "Known
  history and outstanding follow-ups show before knocking."
  - Q2 was put to the owner with "at the base size its top shows above Save". That holds
    on a Pixel 5: 75px at 16px and 47px at 17px.
  - It does not hold on an iPhone 13: 12px at 16px, and nothing at its default 17px.
    Main showed 236px and 222px there, including an Overdue note.
  - Nothing near the unit field says the history is there (verifier r2, R-205).
  - If both decisions stand as written, a member on an iPhone at the default size can
    knock without seeing the household's name or an overdue note.

  Confirm (b) with that cost, which narrows D-25-3, or rule again. The verifier suggests
  a held one-line cue under the unit field.
