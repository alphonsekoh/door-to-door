# #31 · Member management

- **Status:** Done (PR #69)
- **Phase:** 5 - Admin UI
- **Depends on:** #15, #29

## Task

Add members, change roles, deactivate and restore.

## Decisions

- **D-31-1 · `POST /users` with an admin-set initial password**; email lowercased;
  duplicate is `409`. _Refined by D-14-12 (owner, 2026-11-05):_ the password is optional;
  with none the account signs in with Google only. _Refined by D-14-22 (owner,
  2026-11-12):_ only at an address in `auth.google.domains`. _Refined by D-249-9
  (#249):_ the account is approved from the start; an address waiting for approval or
  rejected gets a `409` naming Approve or Unblock.
- **D-31-2 · `User.lastRecordedAt`** (nullable) is "last activity".
- **D-31-3 · Computed with a grouped subquery and left join, not a correlated
  subquery.** _Research:_ R-7.
- **D-31-4 · Initial password is shown unmasked and stays visible after saving.**
  _Why:_ there is no invite email; the admin reads it out. _Refined by D-14-12:_ only when
  there is one; otherwise the notice says the member can sign in with Google.
- **D-31-5 · Admins cannot demote or deactivate themselves — enforced in the service
  (`409`)**, controls hidden on own row. _Why:_ a lone admin would lock everyone out.
  _Extended by D-132-1:_ nobody may demote or deactivate the last active admin, judged
  under a lock on the admins' rows (D-132-2).
- **D-31-6 · The team screen always includes deactivated users.** _Extended by D-249-14
  (#249):_ "Waiting for approval" sits above it and "Not approved" below; neither is part
  of the team list.
