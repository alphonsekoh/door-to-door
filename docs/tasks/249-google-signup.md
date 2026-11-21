# #249 · Google sign-up with admin approval

- **Status:** In progress (branch `feat/249-google-signup-approval`)
- **Phase:** none (no milestone)
- **Depends on:** #14, #15, #31, #83, #85, #105, #125

## Task

Google sign-in stops being invite-only. Anyone Google vouches for on a listed domain may
sign in with Google; a first sign-in makes a pending request, and that person can use
only a waiting page until an admin approves them on Admin → Team. The owner's rulings of
2026-11-21 (issue body): approval always grants Member; rejecting blocks that Google
account until an admin unblocks it; admins learn of requests in the app only; the
request shows Google's name, which the person may correct; deactivated accounts stay
refused and are never re-queued; admins still add people directly, and only admins make
email-and-password accounts. D-15-1 is superseded for Google sign-in.

## Decisions

### The account and the gate

- **D-249-1 · Approval is `users.approval` (`pending`, `approved`, `blocked`; default
  `approved`), and `users_unapproved_check` holds an unapproved account to a member that
  is never deactivated.** _Why:_ no backfill; the unique email makes "cannot ask again"
  free; kept apart from `deactivated_at`, which is for people who were on the team and is
  never re-queued.
- **D-249-2 · A first Google sign-in makes a pending member through the adapter's
  `createUser` (`createAccessRequest`); `getUser` still returns `null` (owner,
  2026-11-21).** It stores no password, no picture, and never Google's `sub` as the id.
  The `jwt` callback starts a sign-in on `signUp` as on `signIn`. **Supersedes D-14-3 in
  part** (signing in creates nobody, `createUser` refused, an account must exist) **and
  D-14-25.** D-14-4 is kept with its reason restated: linking by email is safe because
  only an address Google vouches for (D-14-19) is linked, so the link goes to whoever
  holds the mailbox now, and no user is ever read from a cookie on the phone. _Why:_
  without `signUp` a new account gets no `signInId` and every request is `401`.
  _Research:_ R-156, R-244.
- **D-249-3 · Pending and blocked accounts may sign in; a deactivated one may not.**
  `allowGoogleSignIn` still requires `email_verified`, `googleVouchesFor` and the same
  account Auth.js resolved (D-14-3, D-14-19). _Why:_ the person sees their own state on
  one page, and an unblock reaches them; deactivated stays refused (owner).
- **D-249-4 · `requireUser` enforces approval, failing closed: `403 account_pending` or
  `403 account_blocked`.** Only `requireOwnAccount`, pinned by a scan test to
  `/users/me`, admits an unapproved account. `isAdmin` and `requireAdminPage` require
  `approved`; an admin page sends an unapproved account to `/waiting`. Extends D-16-2,
  D-83-1, D-83-2, D-83-4. _Why:_ the one place every handler and page already authorises.
- **D-249-5 · Approval is read in `checkSignIn`'s one query, so approving, rejecting and
  unblocking land on the person's next request. A rejection ends no sign-ins,** unlike
  deactivation (D-125-10). Extends D-125-3. _Why:_ those sign-ins authorize only
  `/users/me` and sign-out, and keeping them lets an unblock reach the phone.
- **D-249-6 · `POST /users/{id}/approve`, `/reject` and `/unblock`, admin-only, each one
  conditional `UPDATE` from its state; wrong state `409` with a message naming the right
  action, nobody `404`.** Approve is `pending → approved`, reject `pending → blocked`,
  unblock `blocked → pending`. _Why:_ the sessions' start, end and reopen precedent; two
  admins cannot both move one person, and no lock order is added (D-125-11 unchanged).
- **D-249-7 · `GET /users?approval=` defaults to `approved`; `User.approval` is
  required.** A queue lists oldest first, the id breaking a tie (as D-212-1). _Why:_ every picker
  and count stays approved-only without touching a caller.
- **D-249-8 · An unapproved person is "no such member" (`404`) to visit authorship and
  team placement.** _Why:_ they are not on the team, and no picker offers them.
- **D-249-9 · `PATCH /users/{id}` and `POST /users` refuse an unapproved account with
  `409`, pointing to Approve or Unblock; nothing merges.** Refines D-31-1's duplicate
  `409`. _Why:_ approval always grants Member; an add or edit could give a role or a
  password and skip the queue.
- **D-249-20 · A session with no approval value is refused `403 account_pending`, not
  `401`; `requireOwnAccount` reads a missing value as pending.** _Why:_ a `401` sends the
  phone to sign in again, which would loop.
- **D-249-32 · The default refusals read "This account is waiting for an admin's
  approval." and "This account's request wasn't approved."**
- **D-249-34 · Approving sets no role; the check constraint already holds a pending
  account to member. The password path is unchanged:** a pending account has no
  password, so the email form gives it D-15-1's one failure.

### Signing in

- **D-249-10 · The waiting page is `/waiting`, server-rendered from the session's row
  (`requireWaitingPage`), with `pages.newUser` sending a first sign-in straight there.**
  Signed out goes to sign in; approved goes home. _Research:_ R-244.
- **D-249-17 · D-15-1 is superseded for Google sign-in only (owner, 2026-11-21); the
  email form keeps one failure for every refusal.** The issue's "D-15-1 superseded" is
  applied to Google because Google has proved the person holds the address, so what it
  shows them is about their own account; anyone can type an address into the form, and
  only admins make password accounts. D-15-2 and D-151-3 unchanged.
- **D-249-18 · Google's name names a new request, once, if D-74-4's rules accept it;
  otherwise none. No later sign-in changes a name; still no picture and no Google
  tokens.** **Supersedes D-14-7 in part.** _Why:_ the owner wants the request to show who
  is asking; the person corrects it on `/waiting`.
- **D-249-19 · The Google refusal stays one message and drops "addresses your admin
  added":** "That Google account can't sign in here. Google sign-in is for gmail.com,
  tjc.sg or tjc.org accounts; otherwise, use your email and password." With Google set
  up, the sign-in subtitle is "New here? Sign in with Google, then an admin approves
  you." Refines D-14-5. _Why:_ an unknown address is no longer refused, and Auth.js
  passes the page only its own error type (D-14-6). See Known limits and Open questions.
- **D-249-33 · Two first sign-ins racing for one address: the later is refused as
  `AccessDenied` (`SignInRefused`); any other database error propagates.** _Research:_
  R-176.

### The client

- **D-249-11 · The client moves an unapproved account to `/waiting`, never to the account
  message.** `403 account_pending` or `account_blocked` is the store's `"unapproved"`;
  the gate's per-load `/users/me` read does the same when it finds them. Extends D-85-2
  and D-85-7. The sync classifier is unchanged. _Why:_ an approved account never becomes
  unapproved, so no queued record meets these codes.
- **D-249-12 · The proxy does not gate approval.** _Why:_ it has no database, and frozen
  claims would hold an approved person on `/waiting`, looping with its redirect home.
- **D-249-13 · Member pages stay data-free shells, not server-gated; the API is the
  boundary.** This is how the PR reads "opens no page but the waiting page": no member
  page renders data or can save for an unapproved account, and the client moves it on.
  _Why:_ gating them would make every page dynamic, the offline shell included (D-77-7);
  every read they make is refused (D-16-2). See Known limits.
- **D-249-21 · The gate redirects only on an explicit `pending` or `blocked` from
  `/users/me`; a missing value never redirects.** _Why:_ `/waiting` sends an approved
  account home, and the gate would send it back.
- **D-249-22 · Once the refusal or the `/users/me` read has answered, the gate draws
  nothing while it replaces the page with `/waiting`.** _Why:_ a screen's own "Couldn't
  load" must not flash first. Before that answer the screen is drawn (Known limits).
- **D-249-36 · The gate does nothing on `/waiting`; the waiting screen reloads itself
  only when Save name gets `403 account_blocked`.** _Deviation from the plan,_ which had
  the gate reload `/waiting` on any unapproved refusal there. _Why:_ a blanket reload
  would loop on any `account_pending` answer on that page.
- **D-249-23 · No install banner on `/waiting`, and no bottom nav.** _Why:_ the banner
  floated above a nav the page lacks (WebKit E2E), and there is no app to open yet;
  every tab would only lead back.
- **D-249-31 · `/waiting`'s tab title is "Approval"**, to fit both states. Pending:
  "Waiting for approval", Your name with Save name, Check again (a reload), Sign out.
  Blocked: "Your request wasn't approved", Sign out only.

### Admin

- **D-249-14 · Team: "Waiting for approval" on top, "Not approved" at the bottom, each
  hidden when empty; Approve and Unblock are one tap, Reject asks first.** Keeps D-31-6.
  _Why:_ #111 confirms only actions that take something away, and Reject shuts the
  person out. _Corrected reason (review r2):_ Approve is undone only by Deactivate, since
  rejecting an approved account is `409`; one tap gives member access to every
  household's details (Open questions).
- **D-249-26 · The sections are `ApprovalRequests`, hosted by `MemberList`; each reads
  its own list, and a move reloads the list it moved someone into.** They draw while the
  team list is loading or has failed.
- **D-249-27 · A section that cannot load says so on a plain line:** "Could not check who
  is waiting for approval." / "Could not check who wasn't approved." _Why:_ the team
  below still works; an alert would drown it.
- **D-249-28 · A failure is said in its row and scrolled into view (D-195-1, D-213-2);
  one about someone no longer listed, because another admin moved them, is said at the
  top of the section. A `409` reloads the team and both sections.** Up to 100 a section;
  past that, "The oldest N of M are shown."
- **D-249-29 · A row shows the name or "No name given", the address and "Asked {day}",
  wrapped, never cut; Approve, Reject, Unblock and the Reject question name "Name
  (address)", or the address alone.** _Why (verifier r0):_ cut at larger text, or with
  one Google name twice, requests read alike, and Approve is one tap.
- **D-249-39 · `ConfirmDialog`'s title and detail break a word only where it alone is
  wider than the line.** _Why:_ a long address in the Reject question ran off the sheet.
- **D-249-15 · The count is one read per document load in a `src/lib` store
  (`approval-count.ts`), a badge on the Admin tab and a card on the admin landing page;
  Team sets it after each change. No email, no polling (owner).**
- **D-249-24 · A badged Admin tab is named by `aria-label`: "Admin, N waiting for
  approval".** _Why:_ text hidden inside the link was read with a break in it.
  _Research:_ R-245.
- **D-249-25 · The badge uses the danger tokens and sits on the icon's top-right, out of
  the flow; "99+" over 99.** _Why:_ it never makes the nav taller, and shows where the
  label is hidden.
- **D-249-30 · The card hides at zero and when the count cannot be read, and sits above
  the suggestions card; a slow first read never overwrites a newer count from Team.**
- **D-249-16 · No cap on pending requests.** _Why:_ each needs its own Google account
  Google vouches for on a listed domain, a rejection blocks it for good, and the queue
  is admin-only. Revisit if spam appears.
- **D-249-37 · `create-admin` refuses an address waiting for approval and gives the way
  out (D-105-4 kept, review r1).** The refusal prints
  `DELETE FROM users WHERE email = '…' AND approval = 'pending';`, with any `'` doubled,
  or says to make the first admin elsewhere and approve on Admin → Team. It reads the
  approval only after the insert fails. Round 1's takeover of the request was reverted.
  _Why:_ D-105-4, owner-confirmed, says the script only creates; the guard stops a rerun
  deleting an account approved since.

### The contract and tests

- **D-249-38 · Every operation declares a `403`, and a contract test requires it, as one
  already requires a `401`.** Refines D-10-4: any may answer `account_pending` or
  `account_blocked` too. _Why (review r1):_ seven `GET`s answered an undeclared `403`;
  `withContract` never checks an error's status.
- **D-249-35 · E2E: a new address asks, is approved and goes in; another is rejected,
  sees it again on signing in, and is unblocked; one refusal (a consumer account on
  `tjc.sg`) keeps the message.** The stand-in Google takes a `name`.

## Superseded and refined elsewhere

| Decision           | Now                                                                       | By                |
| ------------------ | ------------------------------------------------------------------------- | ----------------- |
| D-15-1             | Superseded for Google sign-in (owner); kept for the email form            | D-249-17          |
| D-14-3             | Superseded in part (owner): a first sign-in makes a pending account       | D-249-2           |
| D-14-25            | Superseded: the `jwt` callback handles `signUp` again                     | D-249-2           |
| D-14-7             | Superseded in part (owner): Google's name names a new request, once       | D-249-18          |
| D-14-4             | Kept; reason restated (Google vouches, not "an admin added")              | D-249-2           |
| D-14-5             | Refined: new text; an unknown address is no longer refused                | D-249-19          |
| D-14 known limit   | Gmail spelling: a second, pending account instead of a refusal            | below             |
| D-10-4             | Refined: also `account_pending`, `account_blocked`; every op declares 403 | D-249-38          |
| D-16-2, D-83-1/2/4 | Extended: `requireUser` enforces approval, fails closed                   | D-249-4           |
| D-85-2, D-85-7     | Extended: unapproved is never the account message; the gate goes on       | D-249-11          |
| D-125-3            | Extended: approval read in the same query                                 | D-249-5           |
| D-125-10           | Kept; a rejection, unlike it, ends no sign-ins                            | D-249-5           |
| D-31-1, D-31-6     | Refined: `409` per approval; Team gains two sections                      | D-249-9, D-249-14 |
| D-105-4            | Kept: a waiting request is refused, with the way out                      | D-249-37          |
| D-151-3, D-86-4    | Kept: the email form's scope of D-15-1                                    | D-249-17          |

## Known limits

- **The member screen shows before `/waiting`.** A waiting or rejected account on a deep
  link or a later sign-in sees the nav, the heading, in WebKit the install banner, and on
  `/blocks/:id` the recording form, until the first refusal or `/users/me` answers:
  about 45 to 135 ms locally, and about 1.6 s when each call takes 1.5 s. No data shows
  and nothing can be saved (D-249-13, D-249-22).
- **A deactivated `gmail.com` Google account is told the wrong reason:** "Google sign-in
  is for gmail.com … accounts; otherwise, use your email and password", under a subtitle
  inviting it to ask to join. Its address is on that list, and a Google-only account has
  no password. It is still refused and not re-queued (Open questions).
- **Gmail spelling.** If an admin added `janedoe@gmail.com` and Google reports
  `jane.doe@gmail.com`, Jane's sign-in is no longer refused: it makes a second, pending
  account, and approving it splits her records. An admin who sees a request from someone
  already on the team should reject it and correct the address. Replaces #14's limit.
- **Team's list has no newest-read guard (D-28-7 not applied).** An approve now reloads it
  without waiting, so two quick approvals on weak signal can draw the team without the
  second person, who has also left Waiting, until a reload (reviewer r0, r2).
- The Waiting section draws nothing while its read is out; if it answers after the team,
  it pushes Add someone and the rows down.
- "All visits sent" shows on `/waiting` and on the rejected page.
- The rejected view has no Check again, so an unblock shows on the next load.
- After an unblock, a request sorts and reads "Asked" by its first ask (`createdAt`).
- Requests are uncapped (D-249-16).
- `create-admin` asks for the password before refusing a waiting address: D-105-6 checks
  only that no admin exists.

## Owner checks (real Google; not claimed by the PR)

- A first sign-in with real Google, in the installed iPhone and Android apps, lands on
  `/waiting` with the Google name, and Check again goes in once approved.

## Relies on

D-13-3, D-14-4, D-14-6, D-14-8, D-14-19, D-15-2, D-16-2, D-28-7, D-31-5, D-31-6, D-74-4,
D-77-7, D-83-2, D-83-12, D-105-3, D-105-4, D-111-5, D-125-2, D-125-10, D-125-11, D-151-3,
D-195-1, D-212-1.

## Open questions

- **What a deactivated Google account should read.** Today it gets D-249-19's message,
  which is false for a `gmail.com` address. The `signIn` callback may return a URL
  instead of refusing (R-244), so a fixed "ask an admin" message is possible without a
  new Auth.js error type. Copy for the owner; not blocking.
- **Should Approve ask first?** It is one tap (D-249-14); its only undo is Deactivate,
  after which the account can never ask again. Not blocking.
