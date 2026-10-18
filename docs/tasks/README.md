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

`D-<issue>-<n>`, e.g. `D-07-2` is the second decision recorded on #7. IDs are never
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

| #   | Task                                                    | Status                                                |
| --- | ------------------------------------------------------- | ----------------------------------------------------- |
| 1   | [Scaffold](01-scaffold.md)                              | Done                                                  |
| 2   | [Docs and project rules](02-docs-and-rules.md)          | Done                                                  |
| 3   | [Lint, format, strict TypeScript](03-lint-and-types.md) | Done                                                  |
| 4   | [Vitest and coverage](04-vitest-coverage.md)            | Done                                                  |
| 5   | [Docker Compose](05-docker.md)                          | Done                                                  |
| 6   | [CI pipeline](06-ci.md)                                 | Done                                                  |
| 7   | [Drizzle schema](07-schema.md)                          | Done                                                  |
| 8   | [Migrations](08-migrations.md)                          | Done                                                  |
| 9   | [Seed](09-seed.md)                                      | Done                                                  |
| 10  | [OpenAPI contract](10-openapi.md)                       | Done                                                  |
| 11  | [Codegen](11-codegen.md)                                | Done                                                  |
| 12  | [withContract](12-with-contract.md)                     | Done                                                  |
| 13  | [Auth.js setup](13-authjs.md)                           | Done                                                  |
| 14  | [Google SSO](14-google-sso.md)                          | Open                                                  |
| 15  | [Credentials sign-in](15-credentials.md)                | Done                                                  |
| 16  | [Route guards](16-route-guards.md)                      | Done                                                  |
| 17  | [Sessions API](17-sessions-api.md)                      | Done                                                  |
| 18  | [Session-blocks API](18-session-blocks-api.md)          | Done                                                  |
| 19  | [Blocks API](19-blocks-api.md)                          | Done                                                  |
| 20  | [Households and visits API](20-visits-api.md)           | Done                                                  |
| 21  | [Sync endpoint](21-sync-endpoint.md)                    | Done                                                  |
| 22  | [Follow-ups API](22-follow-ups-api.md)                  | Done; D-22-2 partly superseded (#96)                  |
| 23  | [History API](23-history-api.md)                        | Done                                                  |
| 24  | [Active session screen](24-active-session-screen.md)    | Done                                                  |
| 25  | [Recording form](25-recording-form.md)                  | Done                                                  |
| 26  | [Block unit list](26-unit-list.md)                      | Done                                                  |
| 27  | [Own history](27-own-history.md)                        | Done                                                  |
| 28  | [Admin sessions](28-admin-sessions.md)                  | Done                                                  |
| 29  | [Admin records](29-admin-records.md)                    | Done                                                  |
| 30  | [Consolidated history](30-consolidated-history.md)      | Done                                                  |
| 31  | [Member management](31-member-management.md)            | Done                                                  |
| 32  | [PWA and service worker](32-pwa.md)                     | Done; D-32-6 refined (#99), D-32-17 superseded (#100) |
| 33  | [Offline queue and sync engine](33-offline-queue.md)    | Done; D-33-22 refined (#100), D-33-8 refined (#101)   |
| 34  | [Offline sync tests](34-offline-tests.md)               | Done (PR #101)                                        |
| 35  | [Follow-up notes UI](35-follow-up-ui.md)                | Done                                                  |
| 36  | [Coverage gaps](36-coverage-gaps.md)                    | Done (PR #103)                                        |
| 37  | [E2E smoke](37-e2e.md)                                  | Done; D-37-3 partly superseded (#93)                  |
| 38  | [Documentation pass](38-docs-pass.md)                   | Done (PR #104); D-38-5 refined (#106)                 |
| 74  | [Teams and own name](74-teams.md)                       | Done                                                  |
| 75  | [Config in YAML](75-config-yaml.md)                     | Done                                                  |
| 76  | [Clock rules](76-clock-rules.md)                        | Done                                                  |
| 77  | [Offline recording screen](77-offline-recording.md)     | Done (PR #100); D-77-11 refined (#106)                |
| 83  | [Per-request auth](83-per-request-auth.md)              | Done                                                  |
| 85  | [Account gone message](85-account-gone-message.md)      | Done                                                  |
| 87  | [Pool errors](87-pool-errors.md)                        | Done                                                  |
| 86  | [Rate limit counts failures](86-rate-limit-failures.md) | Done                                                  |
| 88  | [Flaky load tests](88-flaky-load-tests.md)              | Done                                                  |
| 90  | [Modal sheets](90-modal-sheets.md)                      | Done; D-90-5/7/9 amended (#98)                        |
| 105 | [Create first admin](105-create-admin.md)               | In review (PR #108)                                   |
| 106 | [Standalone output](106-standalone-output.md)           | Done                                                  |
