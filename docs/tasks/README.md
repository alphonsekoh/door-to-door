# Tasks and decisions

One file per GitHub issue. Each records what the task is and the decisions made while
doing it, so a later task can find out what it must not contradict.

## Before deciding anything

1. Search for prior decisions on the same subject:
   `grep -rn "<keyword>" docs/tasks/`
2. If a new decision **conflicts** with an accepted one, do not quietly override it.
   Either change the plan, or supersede the old decision explicitly (below) with the
   owner's agreement.
3. Check the [invariants](#invariants) — they are decisions every task inherits.

## Decision IDs

`D-<issue>-<n>`, e.g. `D-07-2` is the second decision recorded on #7. Work with no
issue takes its PR's number, which no issue can share (D-117-1). IDs are never
reused or renumbered. Research entries in [RESEARCH.md](../RESEARCH.md) are `R-<n>`.

A decision is **Accepted** unless marked otherwise. To change one:

- add the new decision to the task that changes it, with `Supersedes D-xx-n`
- mark the old one `~~struck~~ Superseded by D-yy-m` — leave the text, so the history
  of why stays readable

## Template

```markdown
# #N · Title

- **Status:** Open | In progress | Done (PR #x)
- **Phase:** n - Name
- **Depends on:** #a, #b

## Task

Two or three sentences: what and why.

## Decisions

- **D-N-1 · Short name.** What was decided. _Why:_ the reason. _Research:_ R-n.

## Relies on

Decisions from other tasks this one must not break: D-x-y, D-z-w.

## Open questions

Things only the owner can decide. Remove when answered (and record the answer above).
```

## Invariants

Decisions so load-bearing that every task inherits them. Changing one needs the owner.

| ID     | Invariant                                                                           |
| ------ | ----------------------------------------------------------------------------------- |
| D-07-1 | Household = `(block, unit_number)`; identity is latest-known, non-null updates only |
| D-07-2 | Visit `interest_level` and `description` are never overwritten                      |
| D-07-3 | `visits.id` is a client-generated UUIDv7 with no database default                   |
| D-07-4 | One active session app-wide, enforced by a partial unique index                     |
| D-07-5 | Follow-ups attach to the household, not the session                                 |
| D-10-1 | `openapi.yaml` is the source of truth; change it first                              |
| D-12-1 | Every handler is wrapped in `withContract`, validating both directions              |
| D-16-2 | Authorization is re-checked in every handler; proxy and UI are affordance           |
| D-13-1 | Sessions are JWTs (forced by the Credentials provider)                              |

## Index

| #   | Task                                                    | Status                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Scaffold](01-scaffold.md)                              | Done                                                                                                                                                                                                                  |
| 2   | [Docs and project rules](02-docs-and-rules.md)          | Done                                                                                                                                                                                                                  |
| 3   | [Lint, format, strict TypeScript](03-lint-and-types.md) | Done                                                                                                                                                                                                                  |
| 4   | [Vitest and coverage](04-vitest-coverage.md)            | Done; D-04-2 amended (#36, #115)                                                                                                                                                                                      |
| 5   | [Docker Compose](05-docker.md)                          | Done; D-05-1 kept, migrate and seed split (#124)                                                                                                                                                                      |
| 6   | [CI pipeline](06-ci.md)                                 | Done                                                                                                                                                                                                                  |
| 7   | [Drizzle schema](07-schema.md)                          | Done                                                                                                                                                                                                                  |
| 8   | [Migrations](08-migrations.md)                          | Done; D-08-1 extended (#131)                                                                                                                                                                                          |
| 9   | [Seed](09-seed.md)                                      | Done; D-09-5 extended (#124)                                                                                                                                                                                          |
| 10  | [OpenAPI contract](10-openapi.md)                       | Done; D-10-3 refined (#119)                                                                                                                                                                                           |
| 11  | [Codegen](11-codegen.md)                                | Done                                                                                                                                                                                                                  |
| 12  | [withContract](12-with-contract.md)                     | Done; D-12-5 refined (#119)                                                                                                                                                                                           |
| 13  | [Auth.js setup](13-authjs.md)                           | Done; D-13-5 refined (#115, #14)                                                                                                                                                                                      |
| 14  | [Google SSO](14-google-sso.md)                          | Done (PR #167), with #125 and #162; supersedes D-38-4/18, D-150-4 (owner) and D-14-16 (owner); refines D-31-1/4, D-105-2/7/8, D-113-6; amends D-115-3, D-13-5 (owner); extends D-75-17                                |
| 15  | [Credentials sign-in](15-credentials.md)                | Done; D-15-3 kept and extended (#120, owner); D-15-1 scope stated (#151, owner)                                                                                                                                       |
| 16  | [Route guards](16-route-guards.md)                      | Done; D-16-1 refined (#163, #124)                                                                                                                                                                                     |
| 17  | [Sessions API](17-sessions-api.md)                      | Done                                                                                                                                                                                                                  |
| 18  | [Session-blocks API](18-session-blocks-api.md)          | Done; D-18-1, D-18-2 refined, D-18-3 extended (#117)                                                                                                                                                                  |
| 19  | [Blocks API](19-blocks-api.md)                          | Done                                                                                                                                                                                                                  |
| 20  | [Households and visits API](20-visits-api.md)           | Done                                                                                                                                                                                                                  |
| 21  | [Sync endpoint](21-sync-endpoint.md)                    | Done                                                                                                                                                                                                                  |
| 22  | [Follow-ups API](22-follow-ups-api.md)                  | Done; D-22-2 partly superseded (#96), edit clause superseded, D-22-1 extended, D-22-4 refined and extended (#117)                                                                                                     |
| 23  | [History API](23-history-api.md)                        | Done                                                                                                                                                                                                                  |
| 24  | [Active session screen](24-active-session-screen.md)    | Done; D-24-3 wording refined (#111); D-24-1 refined (#117)                                                                                                                                                            |
| 25  | [Recording form](25-recording-form.md)                  | Done; D-25-4, D-25-5 refined (#111); D-25-5 refined (#117); D-25-2 refined (#113)                                                                                                                                     |
| 26  | [Block unit list](26-unit-list.md)                      | Done; D-26-2 wording refined (#117)                                                                                                                                                                                   |
| 27  | [Own history](27-own-history.md)                        | Done                                                                                                                                                                                                                  |
| 28  | [Admin sessions](28-admin-sessions.md)                  | Done; D-28-5 refined (#125)                                                                                                                                                                                           |
| 29  | [Admin records](29-admin-records.md)                    | Done; D-29-4 refined (#129, #163)                                                                                                                                                                                     |
| 30  | [Consolidated history](30-consolidated-history.md)      | Done; D-30-1 refined (#117); D-30-4 refined (#129, #163)                                                                                                                                                              |
| 31  | [Member management](31-member-management.md)            | Done; D-31-5 extended (#132); D-31-1, D-31-4 refined (#14)                                                                                                                                                            |
| 32  | [PWA and service worker](32-pwa.md)                     | Done; D-32-6 refined (#99), D-32-17 superseded (#100); D-32-13/20/21 refined (#111); D-32-18 extended (#166)                                                                                                          |
| 33  | [Offline queue and sync engine](33-offline-queue.md)    | Done; refined D-33-22 (#100), D-33-8 (#101), D-33-12/29/30 (#111), D-33-16 (#117), D-33-1/2/9/22/28 (#129); D-33-29 partly superseded (#119); D-33-6/27 extended (#126)                                               |
| 34  | [Offline sync tests](34-offline-tests.md)               | Done (PR #101)                                                                                                                                                                                                        |
| 35  | [Follow-up notes UI](35-follow-up-ui.md)                | Done; D-35-1 superseded, D-35-2/6/7/8/9/10/11/12 refined or extended (#117); D-35-6 refined (#160)                                                                                                                    |
| 36  | [Coverage gaps](36-coverage-gaps.md)                    | Done (PR #103); D-36-3 note updated (#113)                                                                                                                                                                            |
| 37  | [E2E smoke](37-e2e.md)                                  | Done; D-37-3 partly superseded (#93)                                                                                                                                                                                  |
| 38  | [Documentation pass](38-docs-pass.md)                   | Done (PR #104); D-38-5 refined (#106); D-38-7 partly superseded (#111); D-38-4, D-38-18 superseded (#14)                                                                                                              |
| 74  | [Teams and own name](74-teams.md)                       | Done; D-74-47 refined, D-74-9 extended, D-74-36/56/57 wording (#111); D-74-15 upheld (#118); D-74-8 extended (#119); D-74-11 refined (#122, #150); D-74-64 extended (#125); D-74-14 gap (#158) closed (#180)          |
| 75  | [Config in YAML](75-config-yaml.md)                     | Done; D-75-15 refined (owner, D-126-8); D-75-17 extended (#14); D-75-6 extended, D-75-19 refined (#124, owner)                                                                                                        |
| 76  | [Clock rules](76-clock-rules.md)                        | Done                                                                                                                                                                                                                  |
| 77  | [Offline recording screen](77-offline-recording.md)     | Done (PR #100); refined D-77-11 (#106), D-77-11, D-77-12, D-77-15 (#111), D-77-3/4/12 (#117), D-77-5/11 (#129); D-77-16 reason amended (#166)                                                                         |
| 83  | [Per-request auth](83-per-request-auth.md)              | Done; D-83-11 refined for POST /visits (#132) and `createTeam` (#158); D-83-4 partly superseded and refined, D-83-15(b) superseded, D-83-15(c) partly closed, D-83-5 scope stated, D-83-7 extended (#125)             |
| 85  | [Account gone message](85-account-gone-message.md)      | Done                                                                                                                                                                                                                  |
| 87  | [Pool errors](87-pool-errors.md)                        | Done; D-87-3 extended, D-87-4 refined, D-87-7 exception (#128)                                                                                                                                                        |
| 86  | [Rate limit counts failures](86-rate-limit-failures.md) | Done; D-86-5, D-86-6 extended (#120)                                                                                                                                                                                  |
| 88  | [Flaky load tests](88-flaky-load-tests.md)              | Done                                                                                                                                                                                                                  |
| 90  | [Modal sheets](90-modal-sheets.md)                      | Done; D-90-5/7/9 amended (#98); D-90-1 partly superseded, D-90-7 to 11 refined (#111); D-90-9 partly superseded, D-90-2/3 refined (#119)                                                                              |
| 105 | [Create first admin](105-create-admin.md)               | Done (PR #108); Relies-on premise made true (#132); D-105-2/7/8 refined (#14)                                                                                                                                         |
| 106 | [Standalone output](106-standalone-output.md)           | Done (PR #107)                                                                                                                                                                                                        |
| 109 | [Private test config](109-private-test-config.md)       | Done (PR #110)                                                                                                                                                                                                        |
| 111 | [Apple design pass](111-apple-design.md)                | Done (PR #112); D-111-50/52 rejected by the owner (D-33-12 kept); D-111-7/25/69 (#117); D-111-26 partly superseded, D-111-13/31/69 refined (#119); D-111-40 (#156); D-111-31/36/48/53/60/65 (#136)                    |
| 113 | [Typing before live](113-typing-before-live.md)         | Done (PR #154); refines D-25-2, D-111-66, D-119-22; corrects D-111-40's note and R-73; D-113-6 refined (#14); D-113-5 superseded, D-113-9 refined (#156); D-113-10 resolved (#155)                                    |
| 115 | [Domain folders](115-domain-folders.md)                 | Done (PR #116); D-115-1 extended (#117, #119); D-115-3 amended for Google (#14, owner)                                                                                                                                |
| 117 | [Follow-up sessions](117-follow-up-sessions.md)         | Done (PR #117); D-117-4 partly, D-117-14, D-117-23 superseded (round 3); D-117-40 refined (round 4); D-117-15/19/24/25/45/59 refined (round 5); #135 left as a known limit (owner); D-117-19 (#156); D-117-71 (#136)  |
| 118 | [Next and zod upgrade](118-next-zod-upgrade.md)         | Done (PR #140); D-118-6 narrowed by the owner, D-74-15 reaffirmed; D-118-6 exposure narrowed (#120, #126); D-118-7 extended (#131, #166)                                                                              |
| 119 | [Blank units and notes](119-blank-text.md)              | Done (PR #141); partly supersedes D-33-29, D-111-26, D-90-9 (owner); refines D-10-3, D-12-5; D-119-23 superseded (D-74-8 upheld, owner); D-119-33 resolved (#136)                                                     |
| 120 | [Sign-in limiter](120-sign-in-limiter.md)               | Done (PR #148); D-15-3 kept and extended, D-86-5/6 extended; D-118-6 exposure narrowed (owner, D-120-7); D-120-8 (#128), D-120-7 (#126) refined                                                                       |
| 121 | [Same-origin writes](121-same-origin-writes.md)         | Done (PR #139); D-121-2 reason and D-121-5 wording corrected, D-121-3 refined by D-121-10 (owner)                                                                                                                     |
| 122 | [Security headers](122-security-headers.md)             | Done (PR #149); refines D-74-11; CSP Report-Only and HSTS without includeSubDomains until #146 (owner); D-122-9 refined (#150); D-122-12 noted (#124), trade-off refined (#151)                                       |
| 123 | [Rights under the lock](123-rights-in-transaction.md)   | Done (PR #153); extends D-117-45, D-18-3, D-74-17; D-74-31 lock mode refined (owner, D-123-2)                                                                                                                         |
| 124 | [Dev stack out of production](124-dev-stack.md)         | Done (PR #179); owner rulings Q1-Q3 (D-124-5/7/8/10) and four nits (D-124-3, D-124-19 to 21); extends D-75-6, D-09-5; refines D-75-19, D-16-1, #5's seeding (D-05-1 kept); last item of the #133 audit                |
| 125 | [Revocable sign-ins](125-sign-ins.md)                   | Done (PR #167), with #14 and #162; supersedes D-83-4 in part and D-83-15(b) (owner); refines D-28-5, D-83-4; extends D-83-7, D-132-5, D-74-64; states D-83-5's scope; restates D-129-4's purpose; D-125-11 (#158)     |
| 126 | [Household paging and limits](126-household-paging.md)  | Done (PR #159); refines D-120-7 and D-75-15 (owner), narrows D-118-6 (D-74-15 kept), extends D-33-6/27 and D-121-8; D-126-3 corrected (#158); D-126-13's paging clause superseded, D-126-1/3 refined (#160)           |
| 127 | [Every page of a block](126-household-paging.md)        | Done (PR #159), with #126 (D-126-10); junk-unit cleanup and a per-member cap not built (D-126-13; its paging clause superseded by #160)                                                                               |
| 128 | [Auth.js log](128-auth-log.md)                          | Done (PR #152, with #150); refines D-87-4, D-120-8; extends D-87-3; exception to D-87-7                                                                                                                               |
| 129 | [Back after sign-out](129-sign-out-leftovers.md)        | Done (PR #161), with #130; refines D-74-10/11, D-33-1/2/9/22/28, D-29-4, D-30-4, D-77-3/5/11; extends D-74-64; D-129-7/9 refined (#163); late-answer limit closed by #162 (D-125-19); D-129-4 purpose restated (#125) |
| 130 | [Lingering data](129-sign-out-leftovers.md)             | Done (PR #161), with #129; recorded there as D-129-6 to D-129-9                                                                                                                                                       |
| 131 | [CI and tooling hygiene](131-ci-hygiene.md)             | Done (PR #173); extends D-08-1, D-118-7; narrows the agent allow list beside D-02-4; image cooldown open; #167 merge order closed (D-131-9); D-131-5 extended (#201)                                                  |
| 132 | [Admin edge cases](132-admin-edge-cases.md)             | Done (PR #157); extends D-31-5, refines D-117-45 and D-83-11; D-132-5 extended (#125, #158); D-132-6 partly superseded (#158, owner)                                                                                  |
| 136 | [Largest text after a save](136-largest-text.md)        | Done (PR #191); extends D-111-60 to sheets (owner); refines D-111-31/36/48/65, D-117-71; resolves D-119-33; #181 part 2 left open                                                                                     |
| 137 | [Follow-up list tab](137-follow-up-list-tab.md)         | Done (PR #147); refines D-117-39 (both links open On the list); records the owner's D-117-65/66 rulings (#138); index updated for merged work                                                                         |
| 150 | [Cookie responses not cached](150-cookie-cache.md)      | Done (PR #152, with #128); refines D-74-11, D-122-9; keeps D-32-19; `/offline` left for #146; D-150-4 superseded (#14, owner); two-cookie limit noted (#151)                                                          |
| 151 | [A refused CSRF check](151-csrf-refusal.md)             | Done (PR #184); resends a `MissingCSRF` sign-in once, then says the page expired (owner); states D-15-1's scope (owner); refines D-122-12's trade-off                                                                 |
| 155 | [Typing as answers land](155-typing-as-answers-land.md) | Done (PR #172), with #156; D-113-10 resolved; urgent paths kept as limits (owner); D-155-2/4 extended (#171); probe in `e2e/` (#176); D-155-2 extended (#160)                                                         |
| 156 | [Save not ready before live](156-save-not-ready.md)     | Done (PR #172), with #155; supersedes D-113-5 (owner); refines D-111-40, D-117-19, D-113-9                                                                                                                            |
| 158 | [Placement locks the placed](158-placement-locks.md)    | Done (PR #177); supersedes D-132-6 for placement (owner); extends D-132-5, D-125-11; refines D-83-11; corrects D-126-3; D-158-2/5/7 refined and its three known limits closed (#180)                                  |
| 160 | [Unit history in pages](160-household-history-pages.md) | Done (PR #190); supersedes D-126-13's paging clause; refines D-126-1/3, D-35-6; extends D-155-2; 20 a page and the control's words (owner, D-160-14/15); iPhone known limit (owner)                                   |
| 162 | [Late answer after sign-out](125-sign-ins.md)           | Done (PR #167), with #125; recorded there as D-125-19 and D-125-20 (owner); closes #129's known limit                                                                                                                 |
| 163 | [CSV `;` and old `?q=`](163-csv-separator-and-old-q.md) | Done (PR #170); refines D-30-4, D-129-9, D-29-4, D-129-7, D-16-1; D-163-4 (owner)                                                                                                                                     |
| 164 | [Sign out above the nav](164-sign-out-above-nav.md)     | Done (PR #178); applies D-125-22 to Account with a new `scroll-clear-nav` (owner, D-164-7); fixes a known limit of #125 and #129                                                                                      |
| 165 | [Bare error bodies](165-error-body-envelope.md)         | Done (PR #169); keeps D-85-2, D-119-16; a bare JSON refusal in the queue follows its status (owner; D-33-17, D-126-11)                                                                                                |
| 166 | [Worker state and Dependabot](166-worker-and-deps.md)   | Done (PR #182), with Dependabot #174 and #175; extends D-32-18, D-118-7; amends D-77-16's reason and R-47; #175 merged after it                                                                                       |
| 171 | [Session name as answers land](171-session-name.md)     | Done (PR #185), with #181; extends D-155-2/4; save continuations left urgent (owner, D-171-4)                                                                                                                         |
| 176 | [The #155 probe in E2E](176-block-screen-probe.md)      | Done (PR #189), with #186; extends D-155-4; narrows a D-171 known limit                                                                                                                                               |
| 180 | [Placement order and locks](180-placement-order.md)     | Done (PR #188); refines D-158-2/5/7; closes D-158-8 and D-74-14's gap; an add refused 404/403, not 409, after a team change (owner)                                                                                   |
| 181 | [Signed out and Notes flakes](181-e2e-flakes.md)        | In progress; part 1 fixed in the spec (PR #185), amends a D-125 limit; part 2's cause found and fixed in the app, Linux run owed; refines D-111-25/35/54; cut stand-in accepted (owner), signed-out landing open      |
| 186 | [Late teams request in tests](186-teams-mock.md)        | Done (PR #189), with #176; test only; four block-screen flakes left for the owner                                                                                                                                     |
| 187 | [Vitest 5 and Dependabot #183](187-vitest-5.md)         | Done (PR #198); takes #183 but its `dev` script (D-124-10 kept); keeps Vitest 5's `clearMocks`; README's Node floor raised; the group D-166-10 waited for                                                             |
| 201 | [Linux E2E gate](201-linux-e2e-gate.md)                 | In progress; CI's E2E job in a local Linux container, and a pre-push gate on it; extends D-131-5; open: keep CI's E2E job, and agents and the gate                                                                    |
