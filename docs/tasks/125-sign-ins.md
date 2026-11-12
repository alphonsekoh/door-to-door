# #125 · Sign-ins that can be ended, one device at a time (with #14 and #162)

- **Status:** In progress (branch `feat/125-sign-ins-and-google`; PR not yet open)
- **Phase:** 7 - Hardening
- **Depends on:** #13, #31, #83, #105, #129, #132. Built with #14 and #162 in one PR.

## Task

A session JWT could not be taken back. Sign-out only cleared the cookie (D-83-15(b)), and
reactivating an account brought every old token back (D-83-4). Each sign-in now has a
server-side row that every request checks, so a sign-out, an admin or a deactivation can
end it. It was built with Google sign-in (#14, recorded in
[14-google-sso.md](14-google-sso.md)), because both change the same sign-in code. It also
fixes #162. The issue's password features are dropped (D-125-1).

## Decisions

### The record and the check

- **D-125-1 · Scope (owner, 2026-11-05).** There are no password features: no change of
  your own password, no forced change at first sign-in, no admin reset and no
  common-password list. The issue's password acceptance criteria are dropped. There is
  no fixed maximum lifetime: the 30-day sliding session stays. _Why:_ sign-in moves to
  Google, and email and password stay only as a fallback (D-14-1).
- **D-125-2 · Each sign-in is a `sign_ins` row, named by a custom `signInId` JWT claim
  (owner, 2026-11-05).** The claim is written once, at sign-in, and deleting the row is
  what ends the sign-in. It is not `iat`, which every refresh rewrites. It is not the
  adapter's `auth_sessions` either, which is keyed by a token the JWT strategy never
  issues (D-07-6 stands). Sessions stay JWTs (D-13-1).
- **D-125-3 · `resolveSession` checks the sign-in in its one query.** `checkSignIn` is
  `users LEFT JOIN sign_ins`:
  - A missing user or an ended sign-in gives `null` (`401`).
  - A deactivated account is `403 account_deactivated`, whatever its sign-in.
  - A live sign-in gives the session with `signInId`. `currentSignIn(role)` passes the
    caller and that id to the admin handlers.

  _Why:_ this keeps D-83-1, D-83-6, D-83-7's one lookup and D-85-2: a deactivated member
  is told so, not "Signed out".

- **D-125-4 · Auth.js's own routes check the sign-in too, and only they do.** Auth.js
  passes a request only to its route handlers (`NextAuth((request) => buildAuthConfig(request))`),
  which is how they are recognised. There, the `jwt` callback returns `null` for an ended
  sign-in or a missing user, so `/api/auth/session` names nobody and clears the cookie.
  _Why:_ `useSession`, the queue's owner check (D-33-1) and D-129-4/5 all ask that
  endpoint. The app's own `auth()` calls carry no request and leave the check to
  `resolveSession`, so an API request still costs one lookup. _Research:_ R-145, R-146.
- **D-125-5 · A claim that is not a UUID.** A `signInId` that is not a UUID is treated as
  ended (`asUuid`) and never reaches the uuid column. On Auth.js's routes, a `sub` that is
  not a UUID names nobody, and at sign-in such a user id is refused. `resolveSession`
  still sends a non-UUID user id to Postgres (a `500`). Only a token signed with
  `AUTH_SECRET` could carry one. _Why:_ a malformed claim must read as signed out, not as
  an error, where the phone asks who it is.
- **D-125-6 · "Last used" is written at most every 15 minutes (owner, 2026-11-05:
  throttle it).** The write is a conditional UPDATE (`last_used_at < now() - 15 min`)
  after the check, on Postgres's clock. _Why:_ a request seldom writes, two requests at
  once write it once, and several app servers agree on the time.
- **D-125-7 · A sign-in unused for 30 days plus 15 minutes has ended.** The per-request
  check and the admin list use the same bound. Such rows are deleted at that member's
  next sign-in. The 30 days is `SESSION_MAX_AGE_SECONDS` (`src/server/auth/lifetime.ts`),
  which Auth.js's `maxAge` also uses. _Why:_ no token naming the row can still be valid,
  and a row in use can read up to 15 minutes older than its last request.
- **D-125-8 · At most 50 sign-ins per account.** A new sign-in past that ends the least
  recently used one. The user agent is cut to 512 characters and shown only as a device
  label, worked out at read time (`describeDevice` in `src/lib/session/device.ts`, for
  example "Chrome on Android", or "Unknown device"). The raw string is never returned.
  _Why:_ this bounds the unpaged list, and the table, against a scripted loop of sign-ins
  with a known password.

### Ending sign-ins

- **D-125-9 · Signing out ends only that sign-in (owner, 2026-11-05).** `events.signOut`
  deletes the token's row, and the member's other devices stay signed in. **Supersedes
  D-83-15(b).**
- **D-125-10 · Deactivation ends all of the member's sign-ins, and reactivation brings
  none back (owner, 2026-11-05).** `updateUser` deletes them in its transaction, after
  D-132-2's locks. A role change ends none. The Deactivate confirmation now reads "They
  will be signed out on every phone and will not be able to sign in. …" **Supersedes
  D-83-4's "Reactivated: works again without signing in".**
- **D-125-11 · Lock order.** Nothing locks a user after a `sign_ins` row, so no wait
  cycle can form with `updateUser` or `updateOwnName`. D-117-45 and D-123-1 to D-123-4
  touch neither table.
  - `startSignIn`'s first statement locks the user `FOR SHARE`, only while the account
    is active. It then prunes, evicts and inserts `sign_ins` rows.
  - Deactivation locks user rows `FOR NO KEY UPDATE` in id order, then deletes from
    `sign_ins`.
  - Touch, end-one, end-all and sign-out are single statements on `sign_ins`.

  This extends D-132-5's analysis, which now has two `FOR SHARE` takers on a user row.
  Parked-lock tests in `sign-ins.integration.test.ts` hold both orders. A sign-in that
  waited for a deactivation is refused and writes nothing. A deactivation that waited for
  a sign-in ends it. _Why:_ no sign-in may outlive a deactivation, or reactivation would
  revive it. _Research:_ R-128, R-129.

- **D-125-12 · Tokens issued before this release carry no `signInId`, so every phone is
  signed out once.** _Why:_ keeping those tokens working would leave every device signed
  in today impossible to end, for as long as it is used. Unsent records stay on the phone
  and send after the member signs in again (D-33-1, D-33-2, D-129-6), as `sign-ins.spec`
  proves. Release note for the owner: deploy outside a live session.
- **D-125-13 · The session endpoint keeps the cookie through a database outage.** A
  failed check there is logged, and the token answers as it did before #125. Every API
  request still answers `500`. D-83-5 holds for authorization, and this states its
  scope: the session endpoint authorizes nothing. _Why:_ without the catch, Auth.js
  clears the cookie when the callback throws (R-146). An outage would then sign out
  every phone that asks: the queue's owner check and the sign-out check.
- **D-125-14 · D-83-15(c) is partly closed.** An ended sign-in now names nobody on
  `/api/auth/session`. A live one still echoes role claims frozen at sign-in.

### Admin screens and API

- **D-125-15 · Admins see and end a member's sign-ins. Members see no list, and Account
  is unchanged (owner, 2026-11-05).**
  - New endpoints: `GET /users/{id}`, `GET` and `DELETE /users/{id}/sign-ins`, and
    `DELETE /users/{id}/sign-ins/{signInId}`. A member gets `403`.
  - Ending one is refused in this order. First, your own current sign-in is
    `409 conflict` ("To sign out of this phone, use Sign out on Account."). Then no such
    user is `404`. Last, a sign-in already ended, or another member's, is `404` "That
    sign-in has already ended."
  - "Sign out everywhere" on your own account keeps your current sign-in.

  _Why:_ this follows D-31-5, which keeps admins from deactivating themselves. Account's
  Sign out is what signs this phone out and clears what it holds (D-129-6).

- **D-125-16 · The member's page is `/admin/team/[id]`.** Every Team card links to it as
  "Sign-ins", your own card included.
  - Each sign-in shows its device, when it signed in and when it was last used. The
    current one reads "This phone" and has no button.
  - A row's Sign out asks for no confirmation. A `404` just reloads the list.
  - "Sign out everywhere" ("Sign out other devices" on your own page) confirms through
    `ConfirmDialog`. The confirmation says records not yet sent stay on those phones.

  _Why:_ there was no member page. A page has a URL and Back, and suits a list of
  buttons better than a sheet does.

- **D-125-17 · `requireAdminPage` sends a request with no live sign-in to
  `/sign-in?reason=signed-out`.** A member still gets a `404`. This refines D-28-5,
  which covers members only, and D-83-4: a deleted account's cookie used to get a `404`
  on admin pages. _Why:_ the proxy has no database (D-16-1) and lets an ended sign-in's
  cookie through. After D-125-12, every admin would otherwise meet a `404` on their own
  screens.

### Tests

- **D-125-18 · Tests sign in for real.** Integration tests that mock `auth()` use
  `signedInAs(pool, user)` (`src/db/testing.ts`). It writes a live sign-in row and
  returns the session with its id. E2E tests that sign out or end sign-ins use the
  `ownAdminPage` and `ownMemberPage` fixtures, signed in through the form by
  `signInThroughForm`. A test that ends all of an account's sign-ins uses an account made
  through `adminApi`. The saved sign-ins are never ended. _Why:_ a session with no live
  row is now signed out, and one spec's sign-out would `401` every spec after it.

### #162: a late answer after sign-out

- **D-125-19 · #162 is fixed on the server.** A service-worker answer that lands after
  sign-out brings back a cookie whose sign-in has ended (D-125-9). Every API request then
  answers `401`, and `/api/auth/session` names nobody and clears the cookie (D-125-4).
  - Proven on mobile-chromium by a held worker request in `sign-ins.spec`. The test
    asserts that the late cookie did land.
  - Playwright's WebKit cannot hold a worker's request (R-138), so on iPhone 13 the
    verifier put the late cookie back by hand. The fix does not depend on the browser.
  - D-129-4 and D-129-5 are unchanged. Their loop stays for a sign-out the server could
    not record (Known limits, first item).

  This closes #129's known limit, and R-137 is updated.

### How existing decisions are handled

| Decision         | Effect                                                                            | By               |
| ---------------- | --------------------------------------------------------------------------------- | ---------------- |
| D-83-15(b)       | Superseded (owner): signing out ends that sign-in                                 | D-125-9          |
| D-83-4           | Partly superseded (owner): reactivation brings no sign-in back                    | D-125-10         |
| D-83-4, D-28-5   | Refined: no live sign-in on an admin page goes to sign-in; members still `404`    | D-125-17         |
| D-83-15(c)       | Partly closed: an ended sign-in names nobody; role claims still stale             | D-125-14         |
| D-83-5           | Scope stated: authorization lookups; the session endpoint keeps its cookie        | D-125-13         |
| D-83-7           | Extended: still one query; at most one write per sign-in per 15 min               | D-125-3, D-125-6 |
| D-132-5          | Extended: `startSignIn` is a second `FOR SHARE` taker; no cycle                   | D-125-11         |
| D-85-2           | Kept: a deactivated account reads as deactivated, whatever its sign-in            | D-125-3          |
| D-16-1           | Kept: the proxy stays database-free                                               | D-125-17         |
| D-129-4, D-129-5 | Kept as they are; #129's known limit is closed                                    | D-125-19         |
| R-137            | Updated: the cookie a late answer sets now signs nobody in                        | D-125-19         |
| D-31-1, D-31-4   | Refined (owner): the password is optional (#14)                                   | D-14-12          |
| D-105-2/7/8      | Refined (owner): a Google-only first admin (#14)                                  | D-14-13          |
| D-113-6          | Refined: sign-in's server HTML holds Google and messages; the form waits for live | D-14-11          |
| D-150-4, D-115-3 | **Conflict, pending the owner** (#14)                                             | D-14-10, D-14-16 |

## Known limits

- If `endSignIn` throws in `events.signOut` (a database error), Auth.js logs it and
  clears the cookie anyway (R-147). The sign-in stays live, so a copied cookie still
  works. A late worker answer (#162) can still sign the member back in until D-129-4's
  loop signs out again. An admin can end the sign-in.
- Every token issued before this release has no `signInId`, so on deploy every phone is
  signed out once (D-125-12).
- The session endpoint keeps the cookie during a database outage (D-125-13).
- Any signed-in client can read its own sign-in id in the `/api/auth/session` JSON,
  because `auth()` hands the app only the session. This is harmless: the id is of no use
  without the cookie it came with.
- A deactivated account reads as deactivated for any token, including one signed out
  before the deactivation. So on a deactivated member's phone, #162's late answer brings
  back the deactivated message, but no data.
- Signing in again over a live cookie leaves the old row listed until it expires after 30
  days.
- The `/sign-in?reason=signed-out` redirect from admin pages drops `callbackUrl`.
- The proxy cannot see an ended sign-in (D-16-1). The page loads, then the first `401`
  raises "Signed out". `/offline` makes no API call and shows the normal Offline page.
- Two sign-ins at the same moment can briefly leave 51 rows.
- iPadOS reads as "Safari on Mac", and an installed app reads as its browser.
- A malformed or unknown member id on `/admin/team/[id]` shows "Invalid path parameters."
  or "No such user." with a Try again that cannot succeed (verifier, a nit).
- Older than this PR, seen by its verifier: after signing in again with records queued,
  History can read "Nothing recorded yet." until reloaded, since it does not refetch after
  a send. `ConfirmDialog`'s title does not wrap a long email, so "Sign … out everywhere?"
  cuts off a member with no name, as "Deactivate …?" already did.

## Relies on

D-07-6, D-13-1, D-16-1, D-28-5, D-31-5, D-33-1, D-33-2, D-83-1, D-83-3, D-83-5, D-83-6,
D-83-7, D-85-2, D-117-45, D-123-1 to D-123-4, D-129-4, D-129-5, D-129-6, D-132-2,
D-132-4, D-132-5.

## Open questions

None for #125: the owner's rulings of 2026-11-05 settle its product calls. #14's two
conflicts (D-150-4, D-115-3) are in [14-google-sso.md](14-google-sso.md#open-questions).
