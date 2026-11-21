# #119 · Blank unit numbers and notes

- **Status:** Done (PR #141)
- **Phase:** 7 - Hardening
- **Depends on:** #20, #21, #22, #117

## Task

A unit number or follow-up note of only spaces passed the request contract, was
trimmed to `''` and stored. It then failed the response contract, so every read that
included it was a `500`, for everyone. This PR refuses blank text in the contract, the
services and the database. It adds a report-only check for rows stored before the fix,
and a pop-up that tells a member or admin why a Save was refused.

## Decisions

### Refusing blank text

- **D-119-1 · Blank is refused by `pattern: "\S"` on the request schemas.** It covers
  both visit `unitNumber`s, both follow-up `note`s, and block `name` and `street` on
  create and update, as `RemoveFollowUpRequest.reason` does (D-117-33). Response
  schemas are unchanged. _Why:_ JavaScript's `\S` matches exactly what `trim()` keeps,
  so a value that passes is never stored empty. A pattern on a response would turn an
  old row, or a copy cached on a phone, back into a `500`. _Research:_ R-101.
- **D-119-2 · A blank sync item refuses the whole batch with `400`,** as any item that
  breaks the schema does. A per-item `rejected` / `validation_failed` comes only from a
  caller that skips the contract. This departs from the issue's wording "rejected for
  sync". _Why:_ one rule in one place. The client's isolation mode (D-33-6) still sends
  the good records and quarantines the bad one.
- **D-119-3 · Services refuse blank text themselves, before any read, lock or write.**
  `requireText` (`src/server/http/text.ts`) returns the trimmed value, or throws
  `validation_failed` with the field's path. The visit, sync, follow-up and block
  services call it first. _Why:_ the rule belongs to the domain, not the transport, so it
  also holds for a caller that skips `withContract`. Refines D-12-5 (owner, 2026-11-03):
  a domain rule stated in its own service is not an unreachable defensive branch, though
  `withContract` refuses the same input first, so the checks stay.
- **D-119-4 · `CHECK (btrim(col) <> '')` on `households.unit_number`,
  `follow_ups.note`, `blocks.name` and `blocks.street`.** They are declared with
  `check()` in `schema.ts` and generated as `0005_not_blank_text`. _Why:_ the last guard
  behind the response's `minLength: 1`. Trade-off: `btrim` strips only spaces, so a
  value of only tabs would pass. The app stores only values trimmed in JavaScript, and
  such a value does not fail a response either. _Research:_ R-102.
- **D-119-5 · No repair migration.** On a database that holds a blank row, `db:migrate`
  fails whole, names the constraint and applies nothing. The README's Troubleshooting
  section sends that failure to `db:check-blank` (D-119-9). _Why:_ migrations are only
  ever generated (D-08-1), and stopping loudly beats rewriting data nobody has reviewed.
  _Research:_ R-103.
- **D-119-6 · Block name and street get the same guard, though only admins write
  them.** They get no pop-up (owner). _Why:_ it is the same flaw, and a blank block
  breaks every block and session read.
- **D-119-7 · A name or contact of only spaces is not learnt, as `null` is not.** One
  that is learnt is stored trimmed. Refines D-10-3, serves D-07-1, and mirrors D-25-6
  on the server. _Why:_ spaces learn nothing, and must not erase a name an earlier visit
  recorded.
- **D-119-8 · Audited, no change needed:**
  - Team and own names are already checked after trimming (D-74-4, D-74-5).
  - The email format rules out whitespace.
  - Session titles and admin-set user names are stored as sent, so they are never
    trimmed to empty.
  - Out of scope: a unit or note of only zero-width characters. JavaScript does not
    count those as space, so the value shows blank but reads without error.
    _Research:_ R-101.

### The blank-text check

- **D-119-9 · `npm run db:check-blank` reports and never repairs (owner).** It lists:
  - every household with a blank unit number: its ids, block and creation time, its
    number of visits, and the first visit's id, author and time
  - every blank follow-up note, removed ones included: author, status and unit
  - every block with a blank name or street

  It runs inside a read-only transaction, and operators run it before migrating to
  `0005`. _Why:_ how each row is repaired is the owner's call, and read-only means a
  mistake cannot change data. _Research:_ R-104.

- **D-119-10 · Each query is its CHECK inverted (`btrim(col) = ''`).** _Why:_ a clean
  report then means the migration will apply. _Research:_ R-102.
- **D-119-11 · Exit codes: `0` clean, `1` found rows, `2` could not check.** _Why:_ a
  deploy can stop before the migration (D-08-4), and a failed check is never read as a
  clean one.
- **D-119-12 · The logic lives in `src/server/integrity/blank-text.ts` (100% gate).**
  `scripts/check-blank-text.ts` only connects, the same way `scripts/migrate.ts` does,
  and sets the exit code. Follows D-08-2. _Why:_ the script stays outside coverage,
  while what it decides is tested. _Refined by D-250-3:_ it connects to `database.url`,
  and `migrate` to `database.migrationUrl` when one is set. It still uses the same
  settings and credentials.
- **D-119-20 · Fix round: repair a blank household by renumbering it, not by deleting
  it.** When the report lists a household it adds this caution, and the README says the
  same. Deleting a household also deletes its visits and notes, so give it its real unit
  number instead. If that unit already exists in the block
  (`households_block_unit_unique`), move the visits and notes there first. _Why:_
  deleting rows to get the migration through would lose the record the app exists to
  keep (D-07-1, D-07-2).

### The Not saved pop-up

- **D-119-13 · A Save refused for a blank unit number or note opens a Not saved pop-up
  (owner, 2026-11-02).** It reads "This visit (or note) could not be saved because:"
  and lists every reason refused at that moment, such as "No interest level is chosen."
  It covers the recording form, Record for a member, and the follow-up sheet's create
  and edit.
  Every note added or edited, an admin's included, goes through that sheet. The line
  beside Save and the field errors stay. Refines D-33-29 and D-111-26, whose one line
  had been the only way the refusal was shown. _Why:_ the owner asked for it. _Refined
  by D-119-25:_ the follow-up sheet's banner keeps what no field error says.
- **D-119-14 · `NotSavedDialog` is a `Sheet` at the dialog layer, with
  `role="alertdialog"`.** It is laid out like `ConfirmDialog`, with one button, OK, and
  opens with focus on OK, as D-90-3 does for confirmations. A backdrop tap counts as OK,
  and it does not drag. It is rendered beside the form's sheet, in `SheetPresence`.
  _Why:_ it can be raised from a sheet and must sit above that sheet and the docked
  Save. With only one way out, there is no choice to make. _Refined by D-119-21:_ it
  opens at its top.
- **D-119-15 · OK returns focus to the first field at fault, scrolled into view clear of
  the pinned chrome (owner, 2026-11-03).** `Sheet` and `useModal` take `returnFocus`,
  read as the dialog closes; without it, D-90-9 holds. The unit and interest fields get
  `scroll-clear-chrome`. For a refusal shown in the pop-up, supersedes D-33-29's "focus
  is not moved" and "chosen over scroll-and-focus", D-111-26's "there is no scroll to
  the field", and D-90-9's return to the element focused at open. A refusal the pop-up
  does not show keeps D-33-29. _Why:_ that field is what the member must fix, and it may
  be off screen. _Refined by D-119-22:_ the field comes back under its label.
- **D-119-16 · A `400 validation_failed` from the server opens the same pop-up.**
  - `ApiRequestError` keeps the error's `details`.
  - An issue is matched to a field by the last segment of its path, and worded "blank
    or too long": the server cannot say which, and the forms send trimmed text.
  - An issue that no field owns keeps the server's message.
  - Any `validation_failed` opens the pop-up, not only one about these fields.

  _Why:_ a refusal the form did not foresee should still say why. _Refined by
  D-119-24:_ a refused choice "was not accepted".

- **D-119-17 · Only blank text opens the pop-up.** A missing choice on its own
  (interest level, member, block) keeps D-111-26's one line, and a note past the limit
  keeps its count and error. _Why:_ the owner asked about blank units and notes, and a
  missing choice is already plain from the line beside Save. _Refined by D-119-26
  (owner):_ a unit too long opens it too.
- **D-119-18 · The reasons are built in `src/lib/not-saved.ts`,** at the top of
  `src/lib`, beside `api-client`. Extends D-115-1. _Why:_ the visit forms and the
  follow-up sheet share it, so it belongs to neither domain.
- **D-119-19 · Fix round: the dialog is described by its lead and its reasons.** It uses
  `aria-describedby`, set through a new `describedBy` prop on `Sheet`. _Why:_ focus
  lands on OK, and the line beside Save is inert behind the dialog, so a screen reader
  said only "Not saved, OK". _Research:_ R-105.
- **D-119-21 · Fix round 2: every modal opens at its top.** `useModal` focuses the
  panel or its first control with `preventScroll`. `Sheet` then resets its body to the
  top, because its own focus scroll (D-111-31) still runs. Refines D-90-2, D-90-3,
  D-111-13, D-111-31 and D-119-14. _Why:_ at the largest text, Not saved with three
  reasons is taller than the screen, and focus on OK opened it at its foot with the
  heading cut away. Trade-off: in a modal taller than the screen, the control that has
  focus can start below the view. _Research:_ R-106.
- **D-119-22 · Fix round 2: OK brings the field back under its label.** The field is
  scrolled to `nearest`, then its `<label>`. A label that `nearest` had to move was cut
  off, so it goes to `start`, and where both cannot fit the label wins. ~~A radio is named
  by its group, so only the radio moves.~~ The recording form's unit label also gets
  `scroll-clear-chrome`. Refines D-119-15. _Why:_ at the largest text, `nearest` lined a
  tall note's foot up with the docked Send and left its label under the sheet's header.
  `start` runs only for a label that was cut off, so at default sizes nothing moves (cf.
  D-111-69). Known limit: on an iPhone 13 at the largest text, the note's label and
  count fill the room above Send, so the field's top starts under Send. _Research:_
  R-89. _Refined by D-119-33 (owner):_ that limit is deferred to #136. _Refined by
  D-113-2:_ a level's radio now has its tile as its `<label>`, which `labelOf` finds. It
  wraps the radio, so nothing more moves. _Known limit closed by D-136-1 and D-136-11._
  _Extended by D-196-5:_ a sheet's focus scroll also brings a box's whole label tile.
- ~~**D-119-23 · Fix round 2: the unit fields stop at the contract's 32 characters.**
  The recording form and Record for a member set `maxLength` from
  `MAX_UNIT_NUMBER_LENGTH` (`src/lib/units/unit-number.ts`). _Why:_ a unit the server
  would refuse is never typed. Trade-offs: the constant copies `openapi.yaml`'s
  `maxLength` by hand, and no test ties the two together. A paste past 32 characters is
  cut without a word. This conflicts with D-74-8.~~ Superseded by D-119-26 (owner,
  2026-11-03).
- **D-119-24 · Fix round 2: a choice the server refuses "was not accepted".** "The
  member (block, interest level) was not accepted." replaces "No … is chosen." Refines
  D-119-16. _Why:_ a choice was sent, so saying none was chosen was false.
- **D-119-25 · Fix round 2: the follow-up sheet's banner keeps a refusal its note has
  no error for,** a bad due date for example. Refines D-119-13. _Why:_ once OK is
  tapped, the sheet would otherwise show nothing about why. The visit forms already
  keep every server refusal in the line beside Save.

### Units too long

- **D-119-26 · A unit past 32 characters is refused with its reason, and nothing is cut
  (owner, 2026-11-03).** Both unit fields lose `maxLength`. Save opens Not saved with
  "The unit number is too long (32 characters at most).", and the recording form never
  queues such a unit on the phone. Supersedes D-119-23; D-74-8 stands. Refines D-119-17.
  _Why:_ D-74-8's reason, that truncation hides why input was cut, holds for every
  field.
- **D-119-27 · The length is judged on the unit as sent, once normalised**
  (`unitNumberFault`, `src/lib/units/unit-number.ts`). Spaces around it do not count,
  and the `#` that normalising adds does. _Why:_ the contract's `maxLength` applies to
  what arrives, so the form refuses exactly what the server would.
- **D-119-28 · A test holds `MAX_UNIT_NUMBER_LENGTH` to `openapi.yaml`.** It reads
  `unitNumber.maxLength` from `CreateVisitRequest` and `VisitSyncItem`. _Why:_ the
  copy now states the number, so a drift would tell members a false limit. Answers
  D-119-23's untested-constant trade-off.
- **D-119-29 · One wording, `UNIT_TOO_LONG` (`src/lib/not-saved.ts`), in the pop-up,
  under the field and in the line beside Save.** _Why:_ one fault should read the same
  wherever the member looks.
- **D-119-30 · The recording form's line beside Save names each field's fault.** A blank
  unit keeps "Enter the unit number" (D-111-26). A unit too long is named as such, with
  "Choose an interest level." after it if that is missing too. Refines D-111-26. _Why:_
  asking for a unit that was given would not say why the Save was refused.
- **D-119-31 · Record for a member's line at the top of its form does the same.** For a
  unit too long, it shows the pop-up's reasons in one line, instead of "Choose a member,
  a block, a unit and an interest level." _Why:_ the same as D-119-30.
- **D-119-32 · A unit error already showing follows the unit as it is typed.** It
  switches between blank and too long, and clears once the unit is fine. An error not
  yet shown waits for Save (or blur, for a blank unit). Refines D-111-26's "clear as
  soon as the field is fixed". _Why:_ typing on past the limit does not fix the unit,
  so the error stays, and says what is wrong now.
- **D-119-33 · The iPhone 13 case of D-119-22 is deferred to #136 (owner, 2026-11-03).**
  `e2e/large-text.spec.ts` checks the note's top edge after OK. That test is marked
  `test.fail` on WebKit, naming #136, and the label is still checked on both phones.
  Refines D-119-22. _Why:_ #136 owns the largest-text layout under the docked action.
  Playwright fails a marked test that passes, so the mark cannot outlive a fix. The
  owner added the case to #136 on 2026-11-03, for the add and the edit sheets, so #136
  is not done until the mark comes off. _Research:_ R-107. _Resolved by D-136-11:_ the
  mark is gone, and all four follow-up sheets are checked.

### How existing decisions are handled

| Decision           | Effect                                                                      | By                 |
| ------------------ | --------------------------------------------------------------------------- | ------------------ |
| D-33-29, D-111-26  | Focus and scroll clauses superseded (owner), for a refusal the pop-up shows | D-119-15           |
| D-90-9             | Partly superseded (owner): `returnFocus` wins where it is given             | D-119-15, D-119-22 |
| D-12-5             | Refined (owner): a domain rule in its own service is not a defensive branch | D-119-3            |
| D-111-69           | Refined: a refusal the pop-up shows scrolls to the field after OK           | D-119-15           |
| D-90-2, D-90-3     | Refined: focus on open does not scroll                                      | D-119-21           |
| D-111-13, D-111-31 | Refined: `Sheet` opens at its top                                           | D-119-21           |
| D-111-26           | Refined: the line names a unit too long; a showing error follows typing     | D-119-30, D-119-32 |
| D-10-3             | Refined: a name or contact of only spaces is not learnt                     | D-119-7            |
| D-115-1            | Extended: `src/lib/not-saved.ts`                                            | D-119-18           |
| D-74-8             | Upheld (owner, 2026-11-03): units are refused, never cut                    | D-119-26           |

## Relies on

D-07-1, D-07-2, D-08-1, D-08-2, D-08-4, D-10-1, D-10-3, D-12-1, D-12-5, D-21-3, D-25-6,
D-33-6, D-33-29, D-74-4, D-74-5, D-74-8, D-90-2, D-90-3, D-90-9, D-111-13, D-111-26,
D-111-31, D-111-69, D-115-1, D-117-33.

## Open questions

None.
