# #131 · CI and agent tooling hygiene

- **Status:** Done (PR #173)
- **Phase:** 7 - Hardening
- **Depends on:** #118, PR #142

## Task

Least-privilege fixes from the 2026-10-28 security audit, so no privileged path appears
later: a read-only CI token kept off disk, actions and images pinned by content and kept
current by Dependabot, `next-auth` pinned exactly, no auto-allowed `npm install` for
agents, and a check that an applied migration's SQL is never edited.

## Decisions

- **D-131-1 · CI's token is read-only.** `ci.yml` declares `permissions: contents: read`
  at the top, and `src/supply-chain.test.ts` refuses any job that sets its own
  `permissions`. _Why:_ nothing in CI writes to the repository, and a job's grant
  replaces the workflow's for that job. The test's job schema declares `permissions`
  because zod strips an undeclared key, which hid a `write-all` job until review.
  _Research:_ R-144, R-6.
- **D-131-2 · Every checkout sets `persist-credentials: false`.** No job runs an
  authenticated git command or `gh` after checkout. _Why:_ by default the token stays on
  disk for the whole job, `npm ci`'s install scripts included. _Research:_ R-145.
- **D-131-3 · Actions are pinned by commit SHA with the exact release in a trailing
  comment:** checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2, cache v6.1.0.
  Each is the commit the floating `v7`/`v6` tag from #142 points at, so nothing runs
  differently. D-118-7's github-actions entry keeps SHA and comment current, and a test
  holds every `uses:` to that form. _Why:_ a tag can be moved, a commit cannot.
  _Research:_ R-146.
- **D-131-4 · Images are pinned `name:tag@sha256:<multi-arch index digest>`:**
  `postgres:17-alpine` in `ci.yml`'s services and `docker-compose.yml`, `node:24-alpine`
  in the Dockerfile. The tag stays for readers and Dependabot. The digests came from
  docker-library/repo-info through `gh api`: Docker was not running and a local hook
  blocks curl to the registry, so the PR's CI run, which pulls them, is the proof.
  _Why:_ a tag is re-pushed on every rebuild; an index digest names one content and
  still serves every platform. _Research:_ R-147.
- **D-131-5 · Dependabot gains `docker` and `docker-compose` entries, extending
  D-118-7:** weekly, one group each, 7-day cooldown, `chore` prefix, labels `type:chore`
  and `area:docker`. New majors of `node` and `postgres` are ignored. _Why:_ D-131-4's
  digests would otherwise go stale, and a major waits for the owner: node moves with
  CI's `NODE_VERSION`, and postgres 18 cannot open a 17 data directory. _Trade-off:_
  every image PR runs the full CI, and the cooldown may hold digests back (Open
  questions). _Research:_ R-95, R-147, R-148.
- **D-131-6 · A test holds CI's postgres service image to `docker-compose.yml`'s.**
  _Why:_ no Dependabot updater reads a workflow's service images, so Compose is the copy
  it updates and CI follows by hand. _Trade-off:_ a docker-compose PR starts red until
  its digest is copied into `ci.yml`. _Research:_ R-148. _Extended by D-244-13:_ the
  stage stack's images are pinned too, and its postgres is held to Compose's.
- **D-131-7 · `next-auth` is exactly `5.0.0-beta.32`,** the version already locked. In
  `package-lock.json` only the root entry changed, and `npm ci` installs the same tree. A
  test refuses any ranged prerelease in `package.json`. _Why:_ `^5.0.0-beta.32` admits
  every later 5.0.0 beta, so an install could move auth to one nobody tested. The same
  rule as the exact pins of D-111-2 and D-118-1. _Research:_ R-149.
- **D-131-8 · Agents lose the `npm install:*` auto-allow, and `npx drizzle-kit:*`
  narrows to `npm run db:generate:*`;** `npm ci` stays. Sits beside D-02-4's deny list.
  _Why:_ agents read issue and PR text, so adding a package now needs the owner. Agents
  run drizzle-kit only as `npm run db:generate` (builder.md; README's `-- --name x` form
  still matches), and a bare `npx drizzle-kit generate` would skip D-131-9's hook. A
  direct `npx drizzle-kit push` or `studio` now asks too.
- **D-131-9 · `drizzle/checksums.sha256` gives D-08-1's "applied ones are never
  edited" a CI check.** The `postdb:generate` hook appends a line per new `.sql` and
  never rewrites one; a unit test fails when a listed migration changed or is gone, or a
  `.sql` file has no line. The format is sha256sum's, and each hash is the one drizzle's
  migrator stores in `__drizzle_migrations`. A file of its own, not the journal the issue
  suggested: `_journal.json` holds no hashes. _Why:_ the migration drift step (D-06-1)
  compares snapshots and never reads `.sql`, so an edited applied migration passed CI.
  _Scope:_ about 150 lines with tests, over the task's ~100, in its own commit
  (`8f53543`) so it can be dropped (see Open questions). _Research:_ R-150.
- **D-131-10 · The checksum list is a tripwire, not a lock.** Rewriting a line launders
  an edit, so review reads any change to the file other than an appended line as an
  edited migration. A migration dropped before it merged takes its line with it.
  `db:generate -- --custom` fails the test: its empty file is recorded before the SQL is
  written. _Why:_ whoever can edit the SQL can edit the list; the check makes the edit
  visible, which is all D-08-1 needs.

## Relies on

D-02-1, D-02-4, D-06-1, D-06-2, D-08-1, D-111-2, D-118-1, D-118-7.

## Open questions

- **Keep D-131-9 over its line budget?** The task allowed about 100 lines with tests;
  it is about 150. Reviewed as sound. Dropping commit `8f53543` removes it whole, and the
  sketch goes under "Still open" in the PR body instead.
- **Will the 7-day cooldown let a digest through?** Docker Hub dates a tag by its last
  push, and a re-push can restart the cooldown (R-148). `node:24-alpine` got 7 new
  digests in the four weeks to 2026-11-12, never more than 7 days apart (R-147), so a
  weekly run may rarely find it old enough. If no docker PR has come in a month, shorten
  or drop the cooldown on the two image entries; that departs from D-118-7 and needs the
  owner. The pins themselves are at most a day old, younger than the cooldown allows.
- ~~**Merge order with PR #167:** its `0006_sign_ins.sql` has no checksum line.~~
  Closed: #131 merged first, and merging `main` into #167 ran `npm run db:generate`,
  which appended `0006_sign_ins.sql` to `drizzle/checksums.sha256` (D-131-9).
- **Owner check after merge:** Dependabot works from the default branch, so whether it
  accepts the `docker` and `docker-compose` entries shows only once this is on `main`
  (Insights → Dependency graph → Dependabot).
