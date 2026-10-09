# #74 · Teams: pairs share and edit each other's records

- **Status:** In progress (PR 2 of 4 in review: #82)
- **Phase:** 4 - Member UI (added later)
- **Depends on:** #31

## Task

Door-to-door is done in pairs: one talks, one records, and they swap. Members join an
outing and form a team for it, and teammates can view and edit each other's records.
Members also set their own display name.

Delivery: PR 1 (#81) is the own-name feature and sign-out hardening. PR 2 (#82) is the server half of participants, teams and teammate access. PRs 3 and 4
(screens) are not built.

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

Numbering continues from D-74-12. Screens are PRs 3 and 4 and are not built.

- **D-74-13 · Outing participants.** `session_participants`, primary key
  `(session_id, user_id)`. `POST /sessions/{id}/join` is the explicit "Join this outing"
  step. Members can join only an ACTIVE outing; admins also a draft; an ended outing is
  `409 session_not_active` for everyone. Joining twice is a no-op (idempotent). There is
  no un-join. Recording a visit auto-joins a MEMBER author, never an admin; being placed
  on a team makes anyone, admins included, a participant. _Why:_ the picker needs a list
  of who is out tonight, and admins supervise rather than knock.
- **D-74-14 · Teams are per outing, any size.** `session_teams` and
  `session_team_members`, unique `(session_id, user_id)` so a person is on one team per
  outing. Members create, rename, add and leave on an ACTIVE outing; admins on a draft
  or ended one as well and can fix any team. Order of checks: `404` (no such team) then
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
  D-21-3.
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

## Follow-ups

Issues #85, #86, #87 and #88 exist for related work found along the way; no decisions
are recorded for them here.

## Relies on

D-21-5 (amended), D-16-4, D-20-2,
D-29-2 (authorship is never reassigned), D-23-1, D-27-4, D-16-2, D-32-7, D-32-4, D-07-3.
D-31-6 uses "team screen" for the admin member list; that is not a team in this task.

## Open questions

- `openapi.yaml` declares `additionalProperties: false` on `UpdateOwnProfileRequest`
  while the description (and generated Zod, which is not strict) ignore unknown fields.
  The spec flag should be dropped or the prose changed; the code's behaviour is D-74-5.
