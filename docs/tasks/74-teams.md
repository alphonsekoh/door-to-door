# #74 · Teams: pairs share and edit each other's records

- **Status:** In progress (PR 1 of 4: #81)
- **Phase:** 4 - Member UI (added later)
- **Depends on:** #31

## Task

Door-to-door is done in pairs: one talks, one records, and they swap. Members join an
outing and form a team for it, and teammates can view and edit each other's records.
Members also set their own display name.

Delivery: PR 1 (#81) is the own-name feature and sign-out hardening. PRs 2-4 (participants,
teams, teammate access) are planned below and not built.

## Decisions

Built in PR 1 (#81) unless marked.

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

## Planned (PRs 2-4, not built)

All Planned, none Accepted until built. Numbering continues from D-74-12.

- **D-74-13 · Outing participants.** A `session_participants` table. A member joins
  with an explicit "Join this outing" tap, and is also joined automatically on recording
  and on team membership. No un-join. Members can join only an ACTIVE outing; admins
  also on a draft; admins are not auto-joined.
- **D-74-14 · Teams are per outing, any size.** `session_teams` and
  `session_team_members` with unique `(session_id, user_id)`. Members create, rename,
  add and leave on an ACTIVE outing; admins on draft or active and can fix any team;
  an ended outing is admin-only.
- **D-74-15 · Who can be added.** Members add only joined, non-deactivated members not
  already on a team; admins add any active user.
- **D-74-16 · `visits.team_id` is stamped once on insert and never updated.** It is the
  membership when the server first stores the visit; an offline record gets the team the
  member had at last sync.
- **D-74-17 · Teammate access = current member of `visit.team_id`.** A joiner can edit
  earlier team records; a leaver loses teammates' records but keeps their own, and the
  team can still edit the leaver's.
- **D-74-18 · A team with stamped records cannot be deleted.**
- **D-74-19 · Join, create, add and leave are online-only and never queued.** UI says
  "Connect to change your team". _Why:_ team state is server truth (D-74-1).
- **D-74-20 · Visits show who recorded them and the "with Ben, Chris" line is a
  snapshot.** The member IDS on the team at recording are stored on the visit, stamped
  once at insert, and displayed with their CURRENT names (a rename shows; a leaver
  stays shown). OWNER DECISION: replaces the planner's "current members" idea.
  `Visit.team` carries the members.
- **D-74-21 · History reads.** `GET /history/mine` gets an opt-in `includeTeam`
  (`memberId` still comes from the session). `/history/mine/sessions` stays own-only.
- **D-74-22 · Teammate sync amend.** Allowed for interest, description and household
  identity only; never author, session, team or household. A stranger stays `conflict`.
  The sync upsert must stop rewriting `memberId`. **Amends D-21-5.**
- **D-74-23 · A teammate's offline amend that arrives after removal from the team is
  refused `conflict` and held in the queue for review** (owner-approved). #33 must treat
  `conflict` as held, not retried.

### How existing decisions are handled

- **D-16-4 / D-20-2:** amended. Members act on their own records, plus teammates' records
  (D-74-17) and, as before, only while the outing is active. Admins unchanged.
- **D-21-5:** amended by D-74-22; strangers still refused.
- **D-23-1:** preserved. `memberId` is still taken from the session only; `includeTeam`
  is a flag, not an identity parameter.
- **D-27-4:** preserved. A unit's timeline stays unscoped.
- **D-29-2:** preserved. Authorship is set once; renames and team changes never move it.
- **D-16-2:** every new handler re-checks server-side.
- **D-07-2:** a teammate's amend edits the same visit, as an admin's already may
  (D-20-2); it is not an overwrite across visits.

## Relies on

D-21-5 (sync refuses another member's visit, needs a team exception), D-16-4, D-20-2,
D-29-2 (authorship is never reassigned), D-23-1, D-27-4, D-16-2, D-32-7, D-32-4, D-07-3.
D-31-6 uses "team screen" for the admin member list; that is not a team in this task.

## Open questions

- `openapi.yaml` declares `additionalProperties: false` on `UpdateOwnProfileRequest`
  while the description (and generated Zod, which is not strict) ignore unknown fields.
  The spec flag should be dropped or the prose changed; the code's behaviour is D-74-5.
