# #105 · Create the first admin on a fresh production database

- **Status:** Done (PR #108)
- **Phase:** 7 - Hardening
- **Depends on:** #31, #38, #75

## Task

A fresh production database has no admin and there is no sign-up. `npm run create-admin`
creates the first one, then refuses forever after. Replaces the README's insert-by-hand
note (D-38-21).

## Decisions

- **D-105-1 · A `tsx` script, logic in `src/server`.** `scripts/create-admin.ts` is glue
  over `src/server/users/first-admin.ts`, `create-admin-cli.ts` and `src/server/prompt.ts`.
  It reads the database like `db:migrate` (`config.yaml` plus exported credentials, no
  `.env`). _Why:_ runs where migrations run (D-38-12); the logic keeps 100% coverage
  (D-08-2, D-09-4 pattern). _Refined by D-250-3:_ it connects to `database.url`, while
  `db:migrate` uses `database.migrationUrl` when one is set. Both use the same settings
  and credentials.
- **D-105-2 · Hashed with the app's own `hashPassword`.** The integration test signs in
  through `authorizeCredentials`. _Why:_ the acceptance criterion is "can sign in", not
  "row has a hash". _Refined by D-14-13 (owner, 2026-11-05):_ a Google-only admin has no
  hash, and its test passes the Google gate (`allowGoogleSignIn`).
- **D-105-3 · Refuses if any admin exists, deactivated ones included; nothing changes.**
  _Why:_ the script must never become a second way to add admins; later admins are added
  on Admin → Team. Owner decision: confirmed; a database left adminless by a hand edit is
  fixed by hand.
- **D-105-4 · An email that already belongs to an account is refused, not promoted.**
  _Why:_ the script only ever creates, never alters, an account. Owner decision:
  confirmed. _Kept by D-249-37 (#249):_ a Google request waiting for approval is refused
  too, and the refusal gives the `DELETE` that clears it.
- **D-105-5 · Check and insert run in one transaction under `pg_advisory_xact_lock`.**
  _Why:_ no constraint can say "no second admin until the first exists", since further
  admins are allowed; a partial unique index would forbid them. Hashing happens before the
  lock so it is not held through argon2. _Research:_ R-56.
- **D-105-6 · Also checked once before prompting.** _Why:_ nobody types a password only
  to be refused; the check under the lock is the one that holds.
- **D-105-7 · No `--password` flag; passing one is refused with where a password may
  come from.** The password comes from `ADMIN_PASSWORD` / `ADMIN_PASSWORD_FILE` (the
  `readSecret` convention, both set is an error, D-75-2) or a no-echo terminal prompt
  asked twice. With neither, it refuses rather than reading a pipe. _Why:_ arguments land
  in shell history and `ps`. _Research:_ R-57. _Amended (review round 2):_ that guarantee
  is claimed only for the prompt and the file; the README recommends
  `ADMIN_PASSWORD_FILE` or `read -rs ADMIN_PASSWORD` without a terminal, and keeps a
  directly set `ADMIN_PASSWORD` for orchestrators and secret managers, since one typed at
  a prompt lands in history. _Refined by D-14-13 (owner, 2026-11-05):_ at a terminal, with
  `auth.google` set, an empty password and the email typed again make a Google-only
  admin. With no terminal and no `ADMIN_PASSWORD(_FILE)` it still refuses. _Refined by
  D-14-23 (owner, 2026-11-12):_ only for an address in `auth.google.domains`.
- **D-105-8 · Input follows the app's rules.** Email and password use the contract's
  `CreateUserRequest` (email up to 320, password 8 to 200) plus
  `assertPasswordAcceptable`; the email is trimmed and lower-cased (D-31-1); `--name`
  uses the own-name rule (D-74-4). _Why:_ an admin made here is indistinguishable from
  one made in the app. _Refined by D-14-13:_ the password is optional, as in
  `CreateUserRequest` (D-14-12), and its rules apply only when one is given.
- **D-105-9 · Fix round: the race test forces the interleaving.** It holds the advisory
  lock on another connection, waits until the run blocks in `pg_locks`, inserts an admin,
  releases, and expects the refusal. _Why:_ the timing-based version failed only about one
  run in six with the lock removed; the forced one fails 5 of 5. _Amended (review round
  2):_ the poll counts only an ungranted advisory lock in `current_database()` on the
  code's own key (`hashtext(CREATE_ADMIN_LOCK)`, passed from the exported constant).
  _Why:_ any other waiter on the server would have released the test early; still fails
  5 of 5 with the lock removed. _Research:_ R-58.

## Relies on

D-31-1, D-31-5 and D-132-1 (no admin can deactivate themselves, and no change leaves the
team without an active admin, so only a hand edit leaves every admin deactivated; before
#132, two admins could deactivate each other at once), D-38-12, D-38-21, D-74-4, D-75-2,
D-08-2.

## Open questions

None. Both were answered by the owner (D-105-3, D-105-4).
