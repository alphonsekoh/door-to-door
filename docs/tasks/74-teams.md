# #74 · Teams: pairs share and edit each other's records

- **Status:** Done (PRs #81, #82, #89, #92)
- **Phase:** 4 - Member UI (added later)
- **Depends on:** #31

## Task

Door-to-door is done in pairs: one talks, one records, and they swap. Members join an
outing and form a team for it, and teammates can view and edit each other's records.
Members also set their own display name.

Delivery: PR 1 (#81) is the own-name feature and sign-out hardening. PR 2 (#82) is the server half of participants, teams and teammate access. PR 3 (#89) is the outing screen: Join and the team card. PR 4 (#92) puts names and teams
on records, adds the Me / My team view, team filters and CSV columns, and the admin team
panel.

## Decisions

D-74-1 to D-74-12 were built in PR 1 (#81).

- **D-74-1 · Unsynced records are visible only on the phone that made them.** Teammates
  see and edit a record once it has synced. _Why:_ two phones with no reception cannot
  share data, and peer-to-peer sync between phones is a separate, much larger piece of
  work. The screens must say so. Recorded here as a reminder to the owner; it is also in
  the README under Known limits.
- **D-74-2 · `PATCH /users/me` (`updateOwnProfile`) is a separate self-service
  operation from admin-only `PATCH /users/{id}`.** It has no id parameter and acts on the
  caller only. _Why:_ a member cannot name another user through it, and the admin route
  keeps its admin-only guard (D-16-2). Admins renaming other users is out of scope.
- **D-74-3 · A name is a label; authorship is by id.** Past records show the new name
  and no record changes author. _Why:_ preserves D-29-2.
- **D-74-4 · Name rules.** Trim, count code points, 1 to 80. Refused: control, format,
  bidi, private-use and unassigned characters, and names with no letter, number or
  emoji. _Why:_ a name that renders blank or spoofs another (zero-width, RTL override)
  misleads teammates in lists and history. _Consequence:_ ZWJ emoji sequences such as the
  family emoji are refused too (the joiner is a format character). _Research:_ R-29.
- **D-74-5 · OpenAPI `maxLength` (400) is a coarse guard on the raw string; the service
  enforces the real rule on the trimmed name.** Unknown body fields are ignored, not
  rejected, and are never mass-assigned. _Why:_ surrounding whitespace must not decide
  the outcome, and a stray `role` must change nothing.
- **D-74-6 · The JWT `update` trigger accepts only a validated display name and ignores
  every other claim.** The token's name is display-only and never used for
  authorization; handlers read the database. _Why:_ the client can call `update()` with
  anything, so the worst a forged update may do is change what its own sender sees.
- **D-74-7 · The Account screen reads the current name from `GET /users/me`, not the
  JWT.** _Why:_ the token can be stale until it is refreshed.
- **D-74-8 · A live "N of 80" counter replaces a silent `maxLength`.** _Why:_ a
  browser that truncates input hides why a name was cut.
- **D-74-9 · Sign-out clears the block cache before signing out; a failed clear never
  blocks sign-out.** It warns first if `hasUnsyncedItems()` is true (a stub until #33).
  _Why:_ the cookie is what protects the account, and clearing first leaves a cache
  rather than a list if the request dies halfway. Completes D-32-7.
- **D-74-10 · Sign-out calls `signOut({ redirect: false })` then
  `window.location.assign("/sign-in")`.** _Why:_ Auth.js builds the returned URL from the
  request host and changed origin under `HOSTNAME=127.0.0.1`; a full navigation also
  drops the signed-in page from memory. _Research:_ R-30.
- **D-74-11 · The proxy sets `Cache-Control: no-store` on signed-in page responses, not
  API responses.** _Why:_ Back after sign-out must revalidate (and be redirected to
  sign-in) rather than restore the signed-in shell from bfcache. _Trade-off:_ signed-in
  pages are not bfcache-restored and always refetch. D-32-4 and D-16-2 intact.
  _Research:_ R-31.
- **D-74-12 · E2E: the sign-out test uses the real button, and the install-banner test
  scrolls and measures together inside `expect.poll`.** _Why:_ the old test measured
  before the page finished growing (reproduced on `main` too); a real overlap still
  stays negative until timeout, so it cannot pass a genuine cover.

## Decisions built in PR 2 (#82, server half)

Numbering continues from D-74-12. The screens are PR 3 (D-74-36 on) and PR 4 (D-74-49 on).

- **D-74-13 · Outing participants.** `session_participants`, primary key
  `(session_id, user_id)`. `POST /sessions/{id}/join` is the explicit "Join this outing"
  step. Members can join only an ACTIVE outing; admins also a draft; an ended outing is
  `409 session_not_active` for everyone. Joining twice is a no-op (idempotent). There is
  no un-join. Recording a visit auto-joins a MEMBER author, never an admin; being placed
  on a team makes anyone, admins included, a participant. _Why:_ the picker needs a list
  of who is out tonight, and admins supervise rather than knock.
- **D-74-14 · Teams are per outing, any size.** `session_teams` and
  `session_team_members`, unique `(session_id, user_id)` so a person is on one team per
  outing. Members create, rename, add and leave on an ACTIVE outing only. Admins create
  on a draft or active outing; on an ended outing nobody can create a team, but admins
  may still rename, add, remove and delete, and can fix any team (wording corrected in
  PR #92 to match the server). Order of checks: `404` (no such team) then
  `403` (a member not on the team) then `409` (`session_not_active`). A member removes
  only themselves (`403` otherwise). _Why:_ the unique key is what makes two concurrent
  "create a team" calls safe; a lost race is a `409 conflict`.
- **D-74-15 · Who can be added.** A member may add any JOINED, active member not already
  on a team, WITHOUT that person's consent; an admin may add any active user.
  OWNER-APPROVED. _Consequence:_ someone can be put on a team they did not choose, and
  then teammates can edit their records and be named on theirs; they leave with a tap
  (D-74-14). `CreateTeamRequest.memberIds` has no cap. A member who creates a team is
  always on it; an admin is on it only if they list themselves.
- **D-74-16 · `visits.team_id` is stamped once on insert and never updated.** It is the
  author's team at the moment the SERVER first stores the visit, so an offline record is
  stamped when it syncs, not when it was knocked. Nullable, `ON DELETE restrict`.
- **D-74-17 · Teammate access = CURRENT member of `visit.team_id`.** A joiner can edit
  earlier team records; a leaver loses teammates' records but keeps their own, and the
  team can still edit the leaver's. One predicate, `canAmend` (admin, author, or current
  teammate), serves `updateVisit` and sync.
- **D-74-18 · A team with stamped records cannot be deleted.** Enforced by the
  `visits.team_id` foreign key and mapped to `409 conflict`, not a count-then-delete.
  _Why:_ a visit stamped between a count and the delete would slip through; the FK is
  race-free. Members must be removed instead.
- **D-74-19 · Join, create, add and leave are online-only and never queued.** UI says
  "Connect to change your team". _Why:_ team state is server truth (D-74-1).
- **D-74-20 · Visits show who recorded them and the "with Ben, Chris" line is a
  snapshot.** `visit_teammates(visit_id, user_id)` stores the team members at storing
  time EXCLUDING the author, written once with the visit. Names are CURRENT, resolved at
  read time (a rename shows; a leaver stays shown). `Visit.team` (`id`, `name`,
  `members`) is on every visit response, required and nullable. OWNER DECISION: replaces
  the planner's "current members" idea.
- **D-74-21 · History reads.** `GET /history/mine?includeTeam` adds records stamped with
  a team the CALLER is on now; the team is derived from the session user, never from the
  request (`memberId` still comes from the session). `/history/mine/sessions` stays
  own-only. `GET /history` (admin) gains a `teamId` filter.
- **D-74-22 · Teammate sync amend.** A current teammate may amend interest, description
  and household identity through sync; never author, session, team, household or
  `clientCreatedAt`. A stranger or ex-teammate gets `conflict`. The sync upsert no
  longer rewrites those columns. **Amends D-21-5.** Write path: see D-74-31.
- **D-74-23 · A teammate's offline amend that arrives after removal from the team is
  refused `conflict` and held in the queue for review** (owner-approved). #33 must treat
  `conflict` as held, not retried. _Consequence:_ a removed teammate whose amend was
  already applied gets `conflict`, not `unchanged`, if the queue retries it.

## Decisions added in PR 2

- **D-74-24 · Schema.** Four tables (`session_participants`, `session_teams`,
  `session_team_members`, `visit_teammates`) and `visits.team_id`, one migration; old
  visits get a null team and no teammates. `session_team_members` carries `session_id`
  with a composite FK `(team_id, session_id)` to `session_teams(id, session_id)`, so a
  member row cannot name a team from another outing. `visit_teammates` cascades with its
  visit; users are `restrict`. _Why:_ the database, not the handler, holds "one team per
  outing" and "team belongs to this outing".
- **D-74-25 · Demoted admins are judged as members.** A demoted admin joining or forming
  a team on a draft gets `409 session_not_active`, not `403`. _Why:_ authorization reads
  the database role (D-83-1), and as a member a draft is simply "not active".
- **D-74-26 · Deactivated users are excluded from live lists** (outing participants,
  team members), so a picker cannot offer them, and cannot be added (`409 conflict`).
  They are still named on old snapshots (D-74-20). _Why:_ consistent with D-29-3;
  history must not lose names.
- **D-74-27 · Stamping is in the same transaction as the insert.** Team, snapshot and
  auto-join are written with the visit, only for a row this call actually inserted. An
  admin recording on someone's behalf stamps the NAMED author's team. _Why:_ a visit
  never exists without the stamp that describes it.
- **D-74-28 · Stale-stamp window accepted.** If the author LEAVES a team between reading
  it and the insert, the visit is stamped with the team they just left. _Why:_ the
  window is milliseconds and the effect is a snapshot slightly out of date; closing it
  needs a lock on every record.
- **D-74-29 · Disbanded mid-record.** If the team is deleted between reading and
  stamping, the FK fails. Sync retries once, re-reading the author's team (now none or
  another). `POST /visits` has the same race and returns a retryable `500`. _Why:_ a
  good record must not be held for a team's disbanding.
- **D-74-30 · Unexpected failures in sync are `rejected` with `internal_error`, which
  is RETRYABLE, never `conflict`.** The cause is logged server-side with the item id
  only; the client sees a generic message. _Why:_ `conflict` is held for review
  (D-74-23), and a dropped connection must not hold a good record forever. Refines
  D-21-3. Refined by D-87-7 (sync failure logs are throttled).
- **D-74-31 · Sync write path.** `INSERT ... ON CONFLICT DO NOTHING RETURNING`: a row
  back means this call created the visit and is the ONLY trigger for the snapshot and
  auto-join. Otherwise `SELECT ... FOR UPDATE`, then RE-JUDGE under the lock (`canAmend`,
  newer `updatedAt`, same household and outing), then a narrow `UPDATE` of
  `interest_level`, `description` and `updated_at` only. _Why not a plain `setWhere`:_
  a team removal committed during the lock wait slips past a subquery that uses the
  statement's snapshot; the lock then a fresh statement sees it (R-34, R-35).
- **D-74-32 · A sync item cannot move a stored visit.** A different block, unit or outing
  is `conflict` for EVERYONE, the author included, and is also enforced under the lock
  (a concurrent first insert on another unit no longer leaves identity written to the
  wrong household: the transaction rolls back). A stored visit keeps its own outing when
  an item omits `sessionId`, which closes the known limit in D-76. _Why:_ moving a
  record is a new record; D-29-2.
- **D-74-33 · Sync never judges an admin as an editor of others' records.** It asks the
  member question (author or current teammate). Admins use `PATCH /visits/{id}`. _Why:_
  the queue is a member's phone; an admin cannot reach another's record through it.
- **D-74-34 · Check order.** Ownership/move checks precede stale/unchanged, then the
  D-76-6 order continues. A replay by the author or a current teammate is still
  `unchanged` (D-76-6, D-21-1 hold); only a removed teammate's replay changes (D-74-23).
- **D-74-35 · `attachTeams` costs two extra queries per page**, however many rows
  (names of stamped teams; snapshots joined to current user names). _Why:_ D-20-3.

## Decisions built in PR 3 (#89, outing screen)

- **D-74-36 · "Join this outing" and "Your team" on the active-session screen.** Join
  shows until the caller appears in `GET` participants, so it is derived from the server
  and recording's auto-join (D-74-13) needs no extra client code. The card offers Pair
  up, rename, add member and leave. Members get no delete (D-74-18: a team with visits
  cannot be deleted anyway). _Why:_ the server is the only truth about who is joined.
- **D-74-37 · The card reads identity from `GET /users/me`, never the JWT.** Relies on
  D-74-7 and D-83-3.
- **D-74-38 · Pair up needs a chosen partner** (the button reads "Choose a teammate"),
  although the API allows a solo team. _Why:_ the screen exists for pairs; a solo team
  is a mistake from a phone.
- **D-74-39 · Default name "Ann & Ben" follows the chosen partner until the user types
  their own.** Truncated to 60 code points, falling back to "Team". Names use the same
  validator as the server (`src/lib/team-name.ts`). _Why:_ client and server cannot
  disagree about what is valid.
- **D-74-40 · An admin forming a team adds themself by listing their own id in
  `memberIds`.** The server does not place admins (D-74-15). The card is not shown for a
  DRAFT outing, because `/sessions/active` returns only active ones.
- **D-74-41 · Picker candidates = participants not already on a team, excluding the
  caller.** After a `409` the card reloads, so people no longer free drop out. One generic
  409 line is shown: the API does not separate "already on a team" from "not joined".
- **D-74-42 · Online-only, nothing queued or stored (applies D-74-19).** Every control is
  disabled with "Connect to change your team" when `navigator.onLine` is false, or after
  a fetch `TypeError` marks the card unreachable until the next successful read or
  `online` event. _Why:_ team state is server truth.
- **D-74-43 · Honest failure wording.** A failed CHANGE says "Could not confirm. Refresh
  to see whether it went through."; never "Nothing was changed". A failed READ says
  "You seem to be offline." Raw server text is never shown; `src/lib/team-ui.ts` maps
  codes to friendly text. _Why:_ a `TypeError` cannot tell a request that never left from
  a reply that was lost (R-36).
- **D-74-44 · One request per tap.** A synchronous in-flight ref guards `change()` and
  the sheet's `submit()`. _Why:_ a double tap used to send two requests and show a false
  409 after the first succeeded.
- **D-74-45 · Stale responses are discarded with a generation counter**, including late
  failures and responses after unmount. The card polls by piggybacking on the screen's
  existing 30s poll and Refresh, and stops on unmount. An auth failure (401 or
  `account_deactivated`) on a poll is shown and disables the controls; a global message
  is issue #85.
- **D-74-46 · The D-74-1 limit is stated under every card state:** "A teammate sees and
  edits your records once they have synced. A record still waiting on your phone is only
  on your phone." The leave dialog says teammates keep access to what you recorded AND
  you lose access to theirs (D-74-17).
- **D-74-47 · Layout.** Sheet `z-50` with a sticky primary button, confirm `z-60`
  (D-30-7), tap targets at least 44px, 16px inputs, long names wrap (`break-words`),
  nothing truncated. The name field sits ABOVE the picker, with `scroll-pb-28` and
  `max-h-[85dvh]`, so the on-screen keyboard can never leave the focused field under the
  sticky Create button. _Why:_ same class of bug as D-30-7. Proven by an E2E
  `elementFromPoint` measurement on both browsers, with the keyboard emulated by
  shrinking the viewport (R-37).
- **D-74-48 · E2E `e2e/teams.spec.ts`.** Two members join, Alice forms a team with Ben,
  Ben sees it after Refresh, Ben leaves. Adds `PARTNER_STATE` (Ben) to the fixtures, ends
  the outing after each test, uses `expect.poll` for layout and exact locators
  (D-37-4, D-37-7, D-74-12).

Known limits: an admin may Pair up without tapping Join (the
server auto-joins them, D-74-13). The character counter and refusal-reason handling are
cosmetic; the server decides. The real two-phone check that A's unsynced record is
invisible to B until it syncs cannot run until the queue (#33) exists.

## Decisions built in PR 4 (#92, names on records, team view, admin panel)

- **D-74-49 · One byline helper (`src/lib/team-label.ts`).** The author first, then the
  SNAPSHOT teammates with CURRENT names ("Alice Tan with Ben Lim, Chris Ong"); a null
  name reads "Someone". Display-only, never used for edit rights. _Why:_ D-74-20 makes
  the snapshot a record of who was there, not who may edit.
- **D-74-50 · Where the byline shows.** Household timeline entries and the household
  header ("Last visit by ...") with a "Team: ..." chip; admin records and all-records with
  the chip; the amend sheet (also when read-only) for someone else's record. Unit rows
  show the byline WITHOUT the chip. Long names wrap, never truncate. _Why:_ the unit row
  is the densest list on a phone.
- **D-74-51 · Outside the team card, the viewer's id comes from the token (`useRole`).**
  _Why:_ D-83-3 keeps identity in the token, and it is only affordance (D-16-2). D-74-37
  is scoped to the card, which also needs the current name.
- **D-74-52 · UI teammate edit rights come only from SERVER-VOUCHED team ids**, never
  the snapshot. On the block screen: `GET /sessions/{id}/teams`, asked once both outing
  and user id are known, newest answer only (generation guard). In the team view: the
  teams of OTHERS' records returned by `includeTeam` (the server only returns them for a
  team the caller is on now). _Why:_ D-74-17; a late empty reply must not hide Amend,
  and asking before the user id was known caused a double fetch.
- **D-74-53 · Amend is a separate button on each own/team history row**, offered only on
  an active outing; the row itself still opens the unit. _Why:_ members can amend only
  while the outing runs (D-16-4 as amended).
- **D-74-54 · A 403 on amend is worded by the right the screen believed in.** Only a
  team route says "You are not on this record's team any more..."; author or admin routes
  say "You can no longer amend this record." Network failures use D-74-43 wording. _Why:_
  a demoted admin was never on the team (D-83-3).
- **D-74-55 · Me / My team lives in the URL as `?view=team`** on `/history` and
  `/history/[id]`; any other value reads as Me. It survives Back and reload; the History
  nav link has no query, so it resets to Me. _Why:_ D-29-4.
- **D-74-56 · The `/history` team view is a flat newest-first list** (20 per page, "Show
  earlier records"), not outing cards. _Why:_ `/history/mine/sessions` lists only outings
  the member recorded in, and its counts stay own (D-27-1); the screen says so.
  Outstanding follow-ups show in both views. The outing page heading is now "Outing
  records".
- **D-74-57 · Empty-state wording.** "Nothing here matches those filters." only when a
  server filter is set, or the client search hides loaded rows; otherwise each screen
  says nothing was recorded (on `/history/[id]`: "You recorded nothing on this outing." or
  "Neither you nor your team recorded anything on this outing."). _Why:_ an empty filtered
  page says nothing about whether anything was recorded.
- **D-74-58 · Admin team filter.** UUID-validated on read; on all-records offered and
  kept only once an outing is chosen and cleared when the outing changes; DROPPED from the
  URL once the loaded team list lacks it, kept if the list cannot be read. _Why:_ D-29-4;
  a team name repeats across outings, and an unknown id would filter to nothing under
  "Any team".
- **D-74-59 · CSV adds Team and Teammates** (teammates joined with `; `), both through
  `escapeCell` (D-30-4). A nameless recorder or teammate exports as "Someone". _Why:_
  team and member names are typed by people; the two columns must agree.
- **D-74-60 · Admin team panel on the outing detail** follows the server's rules: New
  team on draft and active, not ended (the server refuses create on an ended outing for
  everyone); rename, add, remove and delete still allowed on ended. Any active user not
  already placed is offered; the admin is on a team only if they pick themselves
  (D-74-15, D-74-40); the suggested name follows pick order. Deleting a team with records
  is explained with D-74-18 wording. Online-only, one request per tap, honest failure
  wording (D-74-19, D-74-43, D-74-44); it re-reads on the detail screen's 30s poll; the
  sheet follows D-74-47. _Why:_ admins keep full control and can fix a team (issue scope).
- **D-74-61 · Every user picker pages through all users (`loadAllUsers`)**, stopping on
  `hasMore: false` or an empty page. _Why:_ a single `limit=100` page silently dropped the
  101st person.
- **D-74-62 · Native selects carry `h-12`.** iOS WebKit ignores `min-height` on a
  `<select>`; the admin filters measured 26px, now 48px, guarded in `e2e/pwa.spec.ts`.
  Extends D-30-8. _Research:_ R-39.
- **D-74-63 · Double-tap tests click twice inside one `act`.** _Why:_ the earlier tests
  passed with the in-flight guards removed; each guard was broken on purpose and its test
  now fails (D-74-44).

Known limits (PR 4): admin create-user accepts a name with a leading tab (pre-existing;
trimmed on display). One unreproduced WebKit E2E failure ("Save not visible in 30s"),
likely the old double teams fetch fixed by D-74-52.

### Acceptance criteria (#74)

- [x] A member can change their own name (#81).
- [x] Members can form a team before an outing starts - changed: admins on a draft,
      members once it is active (D-74-13, D-74-14).
- [x] Teammates can view and amend each other's synced records; non-teammates cannot
      (#82 server, #89 and #92 screens).
- [x] Authorship never changes when a name or team changes (D-74-3, D-29-2).
- [x] Sync accepts a teammate's amend and refuses a stranger's (D-74-22).
- [x] Refusal tests per rule; phone-width pass in Playwright Chromium and WebKit. The
      PR's real-phone checks are still for the owner.
- [ ] Scope item "the block picker shows the team": not done, see Open questions.

### How existing decisions are handled

- **D-16-4 / D-20-2:** amended. Members act on their own records, plus current
  teammates' (D-74-17), and only while the outing is active (`403` for strangers).
  Admins unchanged. `resolveMemberScope` still refuses another member's scope.
- **D-21-5:** amended by D-74-22; strangers still refused.
- **D-21-1, D-21-2, D-21-4:** relied on. Replay is `unchanged`, older edits `stale`,
  an ended outing `session_not_active` (the stored visit's own outing is used).
- **D-21-3:** refined by D-74-30.
- **D-23-1:** preserved. `memberId` is taken from the session only; `includeTeam` is a
  flag, not an identity parameter.
- **D-27-4:** preserved. A unit's timeline stays unscoped.
- **D-29-2:** preserved. Authorship is set once; renames, team changes and sync never
  move it (the sync upsert no longer rewrites it).
- **D-76-6:** relied on (D-74-34). **D-83-1:** relied on; roles are read per request
  (D-74-25).
- **D-16-2:** every new handler re-checks server-side, inside the service.
- **D-07-2:** a teammate's amend edits the same visit, as an admin's already may
  (D-20-2); it is not an overwrite across visits.

## Decisions from PR #93 (CI flake fix, no issue)

- **D-74-64 · Sign-out fails when the URL Auth.js returns carries an `error` parameter.**
  Extends D-74-10. The Account screen shows its existing "Could not sign out" alert.
  _Why:_ Auth.js answers a refused sign-out (MissingCSRF) with `200` and the session
  survives, so navigating to `/sign-in` told the member they were out when they were not.
  _Known limit:_ the alert says "Check your connection", which is wrong for a refusal;
  wording left as is. _Research:_ R-41.

## Follow-ups

Issues #85 (a global auth-failure message), #86, #87, #88 and #90 (focus trap, Escape and
focus return for sheets and dialogs) exist for related work found along the way; no
decisions are recorded for them here.

## Relies on

D-21-5 (amended), D-16-4, D-20-2,
D-29-2 (authorship is never reassigned), D-23-1, D-27-4, D-16-2, D-32-7, D-32-4, D-07-3.
D-31-6 uses "team screen" for the admin member list; that is not a team in this task.

D-74-1, D-74-7, D-74-19 and D-83-3 are relied on by PR 3 (D-74-36 to D-74-48), along
with D-30-7, D-37-4 and D-37-7. PR 4 relies on D-27-1, D-27-4, D-29-4, D-29-6, D-30-4
and D-30-8.

## Open questions

- **Block picker label.** The issue scope says "the block picker and record lists show
  the team". PR 4 shows teams on units and record lists, but the picker's "X here now"
  label is unchanged (derived from who recorded on the block). Should it read "Alice &
  Ben here now" for a team? Owner to decide.

Answered: (The `additionalProperties: false` flag on `UpdateOwnProfileRequest` was dropped in
PR #81; the spec now says unknown fields are ignored, as D-74-5 records.)
