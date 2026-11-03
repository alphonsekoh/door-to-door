# #119 · Blank unit numbers and notes

- **Status:** In progress (branch `fix/119-blank-values`, no PR yet)
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
  old row, or a copy cached on a phone, back into a `500`. _Research:_ R-95.
- **D-119-2 · A blank sync item refuses the whole batch with `400`,** as any item that
  breaks the schema does. A per-item `rejected` / `validation_failed` comes only from a
  caller that skips the contract. This departs from the issue's wording "rejected for
  sync". _Why:_ one rule in one place. The client's isolation mode (D-33-6) still sends
  the good records and quarantines the bad one.
- **D-119-3 · Services refuse blank text themselves, before any read, lock or write.**
  `requireText` (`src/server/http/text.ts`) returns the trimmed value, or throws
  `validation_failed` with the field's path. The visit, sync, follow-up and block
  services call it first. _Why:_ the rule belongs to the domain, not the transport, so it
  also holds for a caller that skips `withContract`. See Open questions on D-12-5.
- **D-119-4 · `CHECK (btrim(col) <> '')` on `households.unit_number`,
  `follow_ups.note`, `blocks.name` and `blocks.street`.** They are declared with
  `check()` in `schema.ts` and generated as `0005_not_blank_text`. _Why:_ the last guard
  behind the response's `minLength: 1`. Trade-off: `btrim` strips only spaces, so a
  value of only tabs would pass. The app stores only values trimmed in JavaScript, and
  such a value does not fail a response either. _Research:_ R-96.
- **D-119-5 · No repair migration.** On a database that holds a blank row, `db:migrate`
  fails whole, names the constraint and applies nothing. The README's Troubleshooting
  section sends that failure to `db:check-blank` (D-119-9). _Why:_ migrations are only
  ever generated (D-08-1), and stopping loudly beats rewriting data nobody has reviewed.
  _Research:_ R-97.
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
    _Research:_ R-95.

### The blank-text check

- **D-119-9 · `npm run db:check-blank` reports and never repairs (owner).** It lists:
  - every household with a blank unit number: its ids, block and creation time, its
    number of visits, and the first visit's id, author and time
  - every blank follow-up note, removed ones included: author, status and unit
  - every block with a blank name or street

  It runs inside a read-only transaction, and operators run it before migrating to
  `0005`. _Why:_ how each row is repaired is the owner's call, and read-only means a
  mistake cannot change data. _Research:_ R-98.

- **D-119-10 · Each query is its CHECK inverted (`btrim(col) = ''`).** _Why:_ a clean
  report then means the migration will apply. _Research:_ R-96.
- **D-119-11 · Exit codes: `0` clean, `1` found rows, `2` could not check.** _Why:_ a
  deploy can stop before the migration (D-08-4), and a failed check is never read as a
  clean one.
- **D-119-12 · The logic lives in `src/server/integrity/blank-text.ts` (100% gate).**
  `scripts/check-blank-text.ts` only connects, the same way `scripts/migrate.ts` does,
  and sets the exit code. Follows D-08-2. _Why:_ the script stays outside coverage,
  while what it decides is tested.
- **D-119-20 · Fix round: repair a blank household by renumbering it, not by deleting
  it.** When the report lists a household it adds this caution, and the README says the
  same. Deleting a household also deletes its visits and notes, so give it its real unit
  number instead. If that unit already exists in the block
  (`households_block_unit_unique`), move the visits and notes there first. _Why:_
  deleting rows to get the migration through would lose the record the app exists to
  keep (D-07-1, D-07-2).

### The Not saved pop-up

- **D-119-13 · A Save refused for a blank unit number or note opens a Not saved pop-up
  (owner).** It reads "This visit (or note) could not be saved because:" and lists
  every reason refused at that moment, such as "No interest level is chosen." It covers
  the recording form, Record for a member, and the follow-up sheet's create and edit.
  Every note added or edited, an admin's included, goes through that sheet. The line
  beside Save and the field errors stay. Refines D-33-29 and D-111-26, whose one line
  had been the only way the refusal was shown. _Why:_ the owner asked for it.
- **D-119-14 · `NotSavedDialog` is a `Sheet` at the dialog layer, with
  `role="alertdialog"`.** It is laid out like `ConfirmDialog`, with one button, OK, and
  opens with focus on OK, as D-90-3 does for confirmations. A backdrop tap counts as OK,
  and it does not drag. It is rendered beside the form's sheet, in `SheetPresence`.
  _Why:_ it can be raised from a sheet and must sit above that sheet and the docked
  Save. With only one way out, there is no choice to make.
- **D-119-15 · OK returns focus to the first field at fault, scrolled into view clear of
  the pinned chrome.** `Sheet` and `useModal` take `returnFocus`, read as the dialog
  closes; without it, D-90-9 holds. The unit and interest fields get
  `scroll-clear-chrome`. Refines D-90-9. _Why:_ that field is what the member must fix,
  and it may be off screen. **This conflicts with D-33-29 and D-111-26; see Open
  questions.**
- **D-119-16 · A `400 validation_failed` from the server opens the same pop-up.**
  - `ApiRequestError` keeps the error's `details`.
  - An issue is matched to a field by the last segment of its path, and worded "blank
    or too long": the server cannot say which, and the forms send trimmed text.
  - An issue that no field owns keeps the server's message.
  - Any `validation_failed` opens the pop-up, not only one about these fields.

  _Why:_ a refusal the form did not foresee should still say why.

- **D-119-17 · Only blank text opens the pop-up.** A missing choice on its own
  (interest level, member, block) keeps D-111-26's one line, and a note past the limit
  keeps its count and error. _Why:_ the owner asked about blank units and notes, and a
  missing choice is already plain from the line beside Save.
- **D-119-18 · The reasons are built in `src/lib/not-saved.ts`,** at the top of
  `src/lib`, beside `api-client`. Extends D-115-1. _Why:_ the visit forms and the
  follow-up sheet share it, so it belongs to neither domain.
- **D-119-19 · Fix round: the dialog is described by its lead and its reasons.** It uses
  `aria-describedby`, set through a new `describedBy` prop on `Sheet`. _Why:_ focus
  lands on OK, and the line beside Save is inert behind the dialog, so a screen reader
  said only "Not saved, OK". _Research:_ R-99.

## Relies on

D-07-1, D-07-2, D-08-1, D-08-2, D-08-4, D-10-1, D-10-3, D-12-1, D-21-3, D-25-6, D-33-6,
D-33-29, D-74-4, D-74-5, D-90-3, D-90-9, D-111-26, D-115-1, D-117-33.

## Open questions

- **D-119-15 against D-33-29 and D-111-26: may a refused Save move focus to the field
  and scroll to it?**
  - D-33-29 says "A failed save is shown beside Save, and focus is not moved … Chosen
    over scroll-and-focus."
  - D-111-26 says "Extends D-33-29; there is no scroll to the field", and #111 lists
    "D-33-29: a refused Save is explained beside Save; nothing scrolls to the field"
    among the decisions that win over the design skill.
  - D-119-15 does both after OK: it focuses the field at fault and calls
    `scrollIntoView`.

  The owner asked for the pop-up, and a pop-up has to take focus. But the owner's own
  words do not say where focus goes after it closes. If all three stand, the record
  says the app never scrolls to a field while the code does, and a later task could
  remove either behaviour and cite a decision for it. If the owner agrees, D-119-15
  supersedes those clauses for a refusal shown in the pop-up. Otherwise, focus goes
  back to Save (D-90-9) and nothing scrolls.

- **D-119-3 against D-12-5: should the service checks stay?** D-12-5 says "Delete
  unreachable defensive branches rather than cover them". Every production caller of
  these services passes through `withContract`, which refuses blank text first, so
  `requireText` runs only in service tests. The issue's own proposal asked for the
  service check. If both stand, a later coverage pass could delete the checks and cite
  D-12-5. The recommendation is to keep them, recorded as a refinement: a domain rule
  stated in its service is not a defensive branch.
