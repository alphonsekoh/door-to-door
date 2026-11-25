# #279 · Erasure and retention (PDPA)

- **Status:** In progress (PR into `feat/273-privacy-policy`; merges to `dev` together with #276)
- **Phase:** Cross-cutting
- **Depends on:** #273 (the policy this makes true)

## Task

Delete personal data on a request, and when its retention period ends, so the privacy
policy of #273 is true. Households and member accounts are erased; sign-ins are pruned;
phones drop what they hold; an unsent record for an erased unit is refused.

## Decisions

Owner rulings of 2026-11-25 (the plan's eight questions, answer (a) on each) are marked
_(owner)_.

- **D-279-1 · Erasing keeps the household row as the unit alone.** `name`, `contact`,
  `religion` and the withdrawal mark are nulled, `erased_at` is set; visits, follow-up
  notes (removed ones and their reasons) are hard-deleted. `session_households` and
  `session_blocks` stay. _Why:_ the row is the minimal record the sync refusal needs; picks
  and the "at least one household" rule stay untouched. Applies D-273-11. _(owner, Q4:
  delete the visits, no detach.)_
- **D-279-2 · `erasure_requests` holds no personal data.** One of `household_id` or
  `user_id`, when asked, who logged it, when and by whom it was carried out. One open
  request per subject (partial unique indexes); rows are kept as the compliance record.
  _Why:_ who asked is the subject itself; a name would be more data to erase.
- **D-279-3 · A retention erasure writes no request row.** `erased_at` and the
  `retention_runs` counts are its record. The job closes any open request it meets, with
  `erased_by` null (D-279-23).
- **D-279-4 · Last activity at a household** is the newest visit `created_at` or note
  `created_at`, `updated_at`, `listed_at`, `done_at` or `deleted_at`. Amends do not
  count. _Why:_ D-273-4 says "any follow-up activity", and a removal does not touch
  `updated_at`.
- **D-279-5 · A unit that holds nothing is never erased again.**
- **D-279-6 · `household_erased` (409)** applies when the record's `clientCreatedAt` is
  earlier than the unit's `erased_at`, for every caller. Sync checks it after the replay
  short-circuit and **before** the clock bounds; `POST /visits` checks it under the
  household lock, after `assertNotInFuture`. _Why:_ before the bounds, a clock-skew
  restamp cannot launder an old record in sync.
- **D-279-7 · Sync reads the erased places once per batch,** in parallel with the blocks
  read: one more statement, constant in batch size. Refines D-251-2 (four reads), within
  its ceilings.
- **D-279-8 · `getVisit` and the amend lock answer 404** for a visit erased meanwhile.
  Supersedes D-123-6. _(owner, Q3.)_ _Why:_ erasure deletes visits; D-123-6's own
  trade-off line anticipated this.
- **D-279-9 · A follow-up cannot be created on an erased unit** that has no visit since
  (409 `household_erased`).
- **D-279-10 · Unscoped `GET /households` lists only units with a visit.** _Why:_ a bare
  unit in the list would tell members that someone there asked to be erased.
- **D-279-11 · Erasing an account anonymises it in place.** Name, email (to
  `erased-<id>@erased.invalid`), image, password, `email_verified`, Google links, sign-ins
  and verification tokens are removed; visits, notes and teams stay, shown as "Someone".
  Same locks and refusals as `updateUser`: not self, not the last active admin. An erased
  account is on no list and `GET /users/{id}` answers 404. A later Google sign-in with the
  same email makes a new pending account. Supersedes D-29-3. _(owner, Q1 and Q5.)_
- **D-279-12 · Account periods.** Approved: 12 months from `deactivated_at`. Blocked: from
  `updated_at`. Pending (never answered): from `created_at`. Sign-ins: D-125-7's bound,
  now also deleted by the job. Constants live in `src/lib/privacy/policy.ts` (extends
  D-273-14). Refines D-125-7. _(owner, Q1: turned-down and unanswered sign-ups go too.)_
- **D-279-13 · The job takes its time from an injected `Clock`,** one transaction per
  subject, at most 200 households and 200 accounts per run; `more` is set when capped, and
  `maxDuration` is 60. _Why:_ a backlog is then spread over runs, and a fixed clock drives
  the tests.
- **D-279-14 · One run at a time, by a lease row, not an advisory lock.** A unique index on
  the constant `(true)` where `finished_at` is null; a run unfinished for 1 hour is closed
  by the next. A second caller gets 409. _Why:_ Neon's transaction-mode pooler (D-250)
  does not hold session advisory locks.
- **D-279-15 · The cron route is authorised by the bearer `CRON_SECRET` only.** `GET
/api/retention/run`, `cronSecret` scheme; read per request through `readSecret`
  (with `_FILE`), never at module scope or in config, compared in constant time; unset
  means 401 and nothing is read. `src/proxy.ts` skips `auth()` for `CRON_PATH` alone.
  Refines D-13-4, D-16-1 and D-273-9. Vercel Cron calls it daily at `0 18 * * *` UTC
  (02:00 Singapore); a self-hosted install calls the same URL from host cron. _(owner, Q7.)_
  _Research:_ R-261.
- **D-279-16 · A `household_erased` refusal turns the phone record into a no-data "not
  kept" stub at once,** kept 24 hours. The stub is state `synced` with `lastError.code`
  `household_erased`, recognised by `isErased`; there is no new `RecordState` and no
  `isSettled`. It carries only id, block, unit, session and times. Carves out D-33-2 (the
  erased stub). _(owner, Q2.)_
- **D-279-17 · App start purges for every owner, signed in or not** (`purge-on-start.ts`,
  from `SyncProvider`'s mount): sent records and stubs older than 24 hours; any record
  still unsent 30 days after it was saved, held, stopped and unreadable ones included (or
  at once when its time cannot be read); an expired copy, by calling `loadLocalCopy`.
  Only held and stopped records show "Deleted from this phone on <date> if not sent".
  Supersedes D-33-2 in part, D-33-8 and D-34-8; refines D-33-9 and D-77-5. _(owner, Q2.)_
- **D-279-18 · Contact withdrawal is a timestamp** (`contact_withdrawn_at`). A member or an
  admin marks it (409 when no contact is recorded); only an admin clears it; a new contact
  does not clear it; erasure does. It shows beside the contact and as a CSV column. The
  contract field is optional so older phone copies still validate. _(owner, Q6.)_
- **D-279-19 · "Erase by" is 10 weekdays after the request,** Monday to Friday in the
  device's time zone, no holidays: the stricter of the policy's two response times.
- **D-279-20 · Placement.** Members pass on a household's request and mark a withdrawal
  from the unit panel; admins log either kind, erase from the unit page, from
  `/admin/privacy` (Erasure requests) and from a member's page, and clear a withdrawal. A
  member asks for their own account's erasure by email to the operator or via an admin;
  there is no in-app self-request. _(owner, Q6.)_
- **D-279-21 · The policy text changes here.** Erasure, retention rows (visits, accounts,
  sign-up requests, the erasure record), phones (30 days at most), calls and messages, and
  "exported copies are deleted too" (D-279-24). A large backlog "can take a few days"
  (D-279-13), not "within a day". Refines D-273-15. _(owner, Q8 for exports.)_
- **D-279-22 · A unit with zero visits now exists.** `visitCount(0)` reads "No visits".
  Refines D-196-20.
- **D-279-23 · Closing requests.** The job, and `eraseRequest` for an account that is
  already erased, close an open request with `erased_by` null. _Why:_ a request must not
  wait for an erasure that already happened.
- **D-279-24 · CSV exports are the admin's to clean.** The erase sheet reminds the admin to
  delete exports that hold the unit; retention erasures prompt nothing. _(owner, Q8.)_
- **D-279-25 · A retention erasure is dated at its cutoff,** never moving an earlier
  `erased_at` back; `updated_at` and the run row hold when it happened. _Why:_ a record
  saved since the cutoff and synced late is new fieldwork, not erased data.
- **D-279-26 · Code comments cite "D-279" with no number.** Numbering them means editing
  those comments later.

## Supersedes

- **D-29-3** by D-279-11, D-279-12.
- **D-33-2** in part by D-279-16, D-279-17; **D-33-8** and **D-34-8** by D-279-17.
- **D-123-6** by D-279-8.
- **Applies D-273-11:** D-117-4, D-117-33 (a removal's reason is erased with its note),
  D-07-1 and D-07-2 (visits and identity erased; marked in their files).
- **Refined:** D-33-9, D-77-5 (D-279-17); D-125-7 (D-279-12); D-251-2 (D-279-7); D-196-20
  (D-279-22); D-13-4, D-16-1, D-273-9 (D-279-15); D-273-15 (D-279-21).

## Known limits

- **Open: a request met by the job is dated at the cutoff** (D-279-25), so a knock saved
  on a phone before that run and synced after comes back, though the request shows
  carried out. An erasure on a request should be dated at the run. Found by the verifier
  (r2, should-fix 1) and not fixed in this PR; the rule to adopt once it is: dated at the
  run when an open request exists, at the cutoff only for age alone.
- Team names are not erased.
- A record restamped after a clock-skew refusal can come back after an erasure.
- Retention erasures prompt no deletion of CSV exports, though the policy says exported
  copies are deleted.
- A bare erased unit still shows in a follow-up session's picks.
- A request cannot be withdrawn.
- Vercel's log retention is unverified (R-260).
- An All records export walked by offset during an erasure can skip a row.

## Relies on

D-07-3, D-13-4, D-16-2, D-33-9, D-117-4, D-117-33, D-125-7, D-250, D-251-2, D-273-4,
D-273-11, D-273-14.

## For the publish step

The PR body must tell the owner to set `CRON_SECRET` in Vercel Production before the
promotion to `main` (until then the route answers 401 and nothing is erased by age), to
check the footer on Erasure requests after the first run, and that self-hosted installs
call the same URL from host cron with the same bearer header. The PR targets a feature
branch, so CI runs no E2E without the `e2e` label; only `erasure.spec` has run natively
on d8b2ffd, so the publish step's full Linux E2E run is the one that counts.

## Open questions

None for the owner. The known limit above is a bug to fix, not a decision.
