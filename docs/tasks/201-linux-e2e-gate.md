# #201 · CI's E2E job in a local Linux container, and a pre-push gate

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #131, #181

## Task

CI's E2E job was the only place the suite ran on Linux. Its WebKit draws in DejaVu Sans
(R-182, R-192), and its scroll and timing differ from macOS (#181), so some failures
showed only after a push. Each failing push cost a full CI run, and the private repo's
2,000 Actions minutes ran out on 2026-10-22 and again on 2026-11-15. #181's acceptance
also needs a Linux WebKit run that nothing local could give. The owner asked
(2026-11-16) for that run to be gated locally, in Docker, before a push.

## Decisions

- **D-201-1 · The runner is the `Dockerfile`'s `e2e` stage: `ubuntu:26.04` with
  `node:24-bookworm-slim`'s `/usr/local`, `npm ci`, then
  `npx playwright install --with-deps chromium webkit`.** CI's `ubuntu-latest` is
  Ubuntu 26.04: so was the run that failed #181 (43375997037) and the last green one on
  `main` (43627225097, Node 24.22.2). `fonts-dejavu-core` is named as well, and the stage
  sets `CI=true` and `LANG=C.UTF-8` as a GitHub runner does. It sits above `builder`, so
  `runner` stays the last stage, the one a plain `docker build` builds, and it is built
  only with `--target e2e`. _Why:_ the same OS, Node and browser install step as CI's
  E2E job. In the root `Dockerfile`, both base images are held to digests by
  `src/supply-chain.test.ts` (D-131-4) and kept current by Dependabot's docker entry
  (D-131-5), which now ignores `ubuntu` majors and minors, so only the LTS's digest
  moves and the stage changes release only with CI. _Rejected:_ Playwright's own image,
  a second source of browsers and system packages beside CI's install step; and the
  app's `node:24-alpine`, because Playwright does not support musl distributions.
  _Research:_ R-193.
- **D-201-2 · `scripts/e2e-linux.sh` (`npm run test:e2e:linux`) runs a commit, never
  the working copy.** `git archive` streams the commit into `docker cp` on a created
  container, whose image has that commit's own `package-lock.json` installed, and the
  container then starts attached. _Why:_ a pass covers exactly what a push sends, and
  the host's `node_modules`, which hold macOS binaries, never enter the container.
  Docker unpacks the archive because, under amd64 emulation, the image's own `tar`
  cannot create a file (R-193).
- **D-201-3 · The database is CI's postgres service image, read from `ci.yml`, in a
  throwaway container with its data on tmpfs, on a private network.** Nothing is
  published on a host port. _Why:_ the run needs neither the host's Postgres nor a free
  port, so worktrees cannot collide over a port or a database.
- **D-201-4 · Only the reporter differs from CI: `line` and `html` in place of `github`
  and `html`.** `npm run test:e2e`, `CI=true` (no reused server, no `test.only`), one
  worker and no retries all come from `playwright.config.ts` as on CI. It runs on the
  machine's own architecture, and `--platform linux/amd64` runs CI's, under emulation.
  _Why:_ the `github` reporter writes annotations for a CI log; a terminal needs
  progress.
- **D-201-5 · One run at a time per clone.** A lock directory in the shared git
  directory serialises runs across worktrees, and a lock whose process has died is
  taken over. _Why:_ two suites at once slow each other into timeouts that CI, with one
  job per runner, would never see.
- **D-201-6 · `.githooks/pre-push` runs the whole suite on each commit a push sends, and
  refuses the push if it fails.** It is enabled once per clone with
  `git config core.hooksPath .githooks`. It skips branch deletions and pushes that
  change only docs: `docs/`, a top-level `*.md` or `.claude/`, which no E2E test reads
  (`public/README.md` is served, so it counts). `SKIP_E2E_LINUX=1` skips
  it for one push, and CI still runs the suite. _Why:_ a hook cannot be installed from
  the repository. _Rejected:_ a `prepare` script to set `core.hooksPath`, because it
  would also run in `npm ci` in the image, which has no `.git`; and lint, types and unit
  tests in the gate, which run the same on macOS, and which CLAUDE.md already asks for
  before work is done.
- **D-201-7 · A whole-suite pass is recorded by tree in `e2e-linux-passed`, in the
  shared git directory.** A run given Playwright arguments records nothing. The gate
  skips a tree that passed, or one that differs from one of the last 50 that passed only
  in docs. _Why:_ running `npm run test:e2e:linux` before a push makes the push itself
  immediate, and neither a second ref at the same tree nor a docs commit on top of a
  passed one needs another run.

## Relies on

D-131-4 and D-131-5 (images pinned by digest, kept current by Dependabot), D-131-6 (CI's
postgres image is Compose's), D-14-14 (E2E never uses the real Google), R-182 (CI's
WebKit draws in DejaVu Sans).

## Open questions

- **Keep CI's E2E job?** With the gate on, CI's E2E job mostly repeats a pass already
  seen here, and it is about half of each run's billed minutes. CI is still the only
  check that cannot be skipped.
- **Agents and the gate.** A push now runs the suite for about 10 minutes, which is
  longer than an agent's command may wait. The pipeline's publish step should run
  `npm run test:e2e:linux` first and push once it has passed.
