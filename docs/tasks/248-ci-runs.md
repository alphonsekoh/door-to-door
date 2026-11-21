# #248 · CI: run only where it can catch something

- **Status:** In progress (branch `chore/248-ci-runs`, stacked on `chore/244-stage-stack`, not yet a PR)
- **Phase:** none (no milestone)
- **Depends on:** #6, #37, #131, #201, #244

## Task

Every push to an open PR ran all four jobs again: about 8 minutes, and 17 to 19 billed
runner minutes. PRs took 3 to 9 commits. CI now runs only where it can catch something:
on ready PRs, with lint first, the suite only for code, and E2E only into `stage` or
`main` or on request. Dependabot no longer rebases unasked. The owner set the shape on
2026-11-21 (the issue's "Decided" list).

## Decisions

### When CI runs

- **D-248-1 · CI runs on pull requests only, and the push run on `main` is gone
  (owner).** `ci.yml` triggers on `opened`, `synchronize`, `reopened` and
  `ready_for_review`. _Why:_ the `stage` → `main` promotion PR already tested the same
  tree, and Vercel deploys `main`. Changes #6's task line ("every PR and push to
  `main`"). _Research:_ R-240.
- **D-248-2 · A draft runs no job, and marking it ready runs CI once (owner).** The lint
  job skips while `draft` is true, and every other job needs it. _Why:_ PRs take review
  fixes as drafts. _Trade-off:_ the draft's skipped checks pass, and only the draft
  state stops a merge (Open question 4).
- **D-248-3 · The lint job runs first, and the others need it (owner).** _Why:_ a lint,
  type or format failure stops the run in about two minutes. _Trade-off:_ a green run
  takes about two minutes longer.
- **D-248-4 · A docs-only PR skips tests and the build through a job's `if:`, never a
  workflow's `paths-ignore` (owner).** Lint, format included, still runs. _Why:_ a job
  skipped by `if:` passes a required check, while a skipped workflow leaves it pending
  and blocks the merge. _Research:_ R-238.
- **D-248-5 · `scripts/ci-changes.sh` decides "docs only", in a step of the lint job.**
  Docs are `docs/`, `.claude/` and top-level `*.md`, except `README.md`, which counts as
  code. Any other path, or no path at all, is code. It diffs the test merge commit
  against its first parent, without rename detection. _Why:_ `src/dev-stack.test.ts` and
  `src/stage-stack.test.ts` read README's sections, so this filter differs from the
  pre-push gate's (D-201-6) on purpose. It is a step, not the issue's separate `changes`
  job: every other job already waits for lint, so the step adds no wait, runner or
  check. _Research:_ R-240.

### E2E

- **D-248-6 · E2E runs on every PR into `stage` or `main`, and elsewhere only with the
  `e2e` label (owner).** `scripts/ci-e2e.sh` decides from the base and the labels. It
  fails closed: a missing base runs E2E. It compares names ignoring case, as GitHub's
  expressions do. Before each push from a clone, the pre-push gate still runs E2E in
  CI's container (D-201-6). _Why:_ a promotion is the last automated check before users
  see a change. Elsewhere, the gate has already run the same suite. Refines D-37-5. It
  supersedes D-201-6's "CI still runs the suite" and answers #201's "Keep CI's E2E job?".
  _Research:_ R-240.
- **D-248-7 · E2E ignores the docs filter.** A docs-only PR into `stage` or `main` runs
  E2E but skips tests and the build. _Why:_ the owner's rule is "always" into `stage`
  and `main`.
- **D-248-8 · A late `e2e` label, or a retarget to `stage` or `main`, runs E2E in a
  separate workflow, `e2e-catch-up.yml`.** It triggers on `labeled`, and on `edited` when
  `changes.base` is set. Its one job is `ci.yml`'s E2E job, and `src/ci-runs.test.ts`
  holds the two equal. The job is named **End-to-end smoke** only when it runs, and "No
  end-to-end run" otherwise. The workflow has no concurrency group. _Why:_ in `ci.yml`,
  these events would cancel the run in progress and skip its jobs. A skip reported later
  under a required name passes the check, and as the newest check it would hide an
  earlier failure. With no concurrency group, a title edit cannot cancel a retarget's run.
  _Trade-off:_ the acceptance item "adding any label other than `e2e` starts no new run"
  is met as "starts no job". Every label, each of Dependabot's included, creates a
  catch-up run whose one job is skipped under a name no ruleset requires.
  _Research:_ R-238, R-240.
- **D-248-9 · A placeholder job reports "End-to-end smoke" skipped as CI's run
  begins.** `e2e-placeholder` has a fixed name and `if: false`. CI's E2E job takes the
  required name only when lint succeeded and asked for E2E. _Why:_ the E2E job waits for
  lint, so its skip would come about two minutes in. That skip would outrank an E2E run
  started by a label in the meantime (review r0). With a fixed name, the required check
  never depends on how GitHub names a skipped job whose name is an expression.
  _Research:_ R-238.
- **D-248-10 · The lint job reads the PR's base and labels from the API, as they are
  now.** Its first step calls `gh api …/pulls/<n>` before checkout and `npm ci`. Only
  that step's environment holds the token. `ci.yml` gains `pull-requests: read`. _Why:_
  a re-run replays the event that started it, so it would miss any later label or
  retarget. Its skipped E2E would then hide a failed catch-up run (review r1). Extends
  D-131-1, since the token is still read-only. Keeps D-131-2: no `gh` runs after
  checkout. _Research:_ R-239.
- **D-248-11 · Re-running all jobs runs lint even in a draft's run
  (`github.run_attempt != '1'`).** _Why:_ suppose a draft's run is re-run after the PR
  was marked ready on the same commit. Without this, all four required checks would
  report skipped over the ready run's. Re-running only failed jobs keeps lint's
  decision unless lint is among them. _Research:_ R-239.

### Jobs, Dependabot and the docs

- **D-248-12 · Every job has a `timeout-minutes` (owner).** Lint 10, tests 15, E2E 20 (in
  both workflows), build 10, placeholder 1. _Why:_ the default is 360 minutes.
  _Research:_ R-240.
- **D-248-13 · The E2E job caches Playwright's browsers (owner).** The cache holds
  `~/.cache/ms-playwright`, keyed by OS name and release, architecture and
  `playwright-core`'s version. On a hit, only `playwright install-deps` runs, for the
  system packages. _Why:_ the issue estimated a minute saved per run. _Trade-off:_
  Playwright advises against it, because a restore takes about as long as a download
  (R-243). With no push runs, a PR's first run finds no cache (R-241, Open question 3).
- **D-248-14 · Dependabot runs monthly with `rebase-strategy: disabled`, and keeps
  `target-branch: dev` (owner).** Comment `@dependabot rebase` on a PR to update it.
  _Why:_ each rebase is a CI run, and Dependabot rebases every open PR whenever `dev`
  moves. Supersedes the weekly schedule of D-118-7 and D-131-5. _Trade-off:_ PRs opened
  before this keep being rebased for 30 days. The file is read from `main`, so the change
  waits for a promotion (as D-244-3). Security updates take none of these options
  (D-244-29), so they are still rebased. D-131's image cooldown gets one try a month
  instead of four. _Research:_ R-242, R-228.
- **D-248-15 · Every Dependabot entry adds the `e2e` label (builder; for the owner,
  Open question 1).** _Why:_ Dependabot's commits never pass `.githooks/pre-push`, so a
  bump into `dev` would get no E2E before promotion. A commit made on GitHub (a web edit,
  **Update branch**) has the same gap. README asks for the label by hand there, and on a
  retargeted security update, which arrives with no labels (D-244-29). _Trade-off:_ each
  Dependabot PR still runs the full CI, as D-118-7 and D-131-5 assumed. Its label lands
  seconds after it opens, so E2E usually runs twice on its first commit, once in each
  workflow. _Research:_ R-242.
- **D-248-16 · `src/ci-runs.test.ts` plays each event through the workflows
  themselves.** The model in `test/github-actions.ts` covers only what the workflows use:
  `pull_request` triggers, re-runs, `needs`, a job's `if`, name and outputs, the two
  scripts, and the expression syntax. It throws on anything else. _Why:_ Vitest cannot
  run GitHub, and a new construct should fail a test rather than be misread.
  _Trade-off:_ the model holds R-238 to R-240 as they were read. Only GitHub can prove
  the real behaviour, after the push (the PR body lists the checks).
- **D-248-17 · CLAUDE.md's Playwright rule and README's CI section describe the triggers
  (owner).** No other CLAUDE.md rule changed. _Why:_ the issue's acceptance asks for it.

## How existing decisions are handled

| Decision                             | Effect                                                                                           | By            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------- |
| #6's task line, D-06-1               | The push run is removed (owner). Lint runs first, and tests and the build skip for docs          | D-248-1, 3, 4 |
| D-37-5                               | Refined: E2E is conditional, and `e2e-catch-up.yml` holds a copy                                 | D-248-6, 8    |
| D-118-7, D-131-5                     | Weekly superseded by monthly, with no rebases (owner). The full-CI trade-off holds via the label | D-248-14, 15  |
| D-131-1                              | Extended: `ci.yml` adds `pull-requests: read`, still read-only                                   | D-248-10      |
| D-131-2                              | Kept: the one `gh` call comes before checkout                                                    | D-248-10      |
| D-131-6                              | Extended: `e2e-catch-up.yml`'s postgres too. `supply-chain.test.ts` reads every workflow         | D-248-8       |
| D-201-6, #201's "Keep CI's E2E job?" | "CI still runs the suite" superseded, and the question answered (owner). The gate is unchanged   | D-248-6       |
| D-244-29                             | Kept: `dependabot.yml` says security updates take none of an entry's options                     | D-248-14, 15  |
| D-244-30                             | Relied on: `main` requires the four checks, so E2E into `main` counts there                      | D-248-6       |

## Known limits

- **A retarget runs only E2E.** Lint, tests and the build are not re-run against the new
  base. Close and reopen the PR for that.
- **Every label starts a catch-up run.** Its one job is skipped. A label added before lint
  reads it runs E2E in both workflows.
- **A conflicting PR runs nothing** (R-240). With rebases off, a conflicting Dependabot
  PR shows no checks until `@dependabot rebase`.
- **Cold caches.** npm's cache, `.next/cache` and the browsers are now kept per PR
  (Open question 3).
- **Unproven on GitHub until the push.** Until then, only the model (D-248-16) supports
  any of this.

## Relies on

D-06-2, D-131-1, D-131-2, D-131-3, D-131-4, D-131-6, D-201-1, D-201-6, D-201-7, D-244-1,
D-244-3, D-244-29, D-244-30.

## Open questions

1. **Dependabot's `e2e` label (D-248-15)** is the builder's choice, outside the "Decided"
   list. Should Dependabot PRs keep it, or skip E2E into `dev` until promotion?
2. **Agent prompts are stale.** `.claude/agents/builder.md` step 8 opens a ready PR, so
   D-248-2 saves agents nothing until it opens a draft and marks it ready at the end, as
   the issue expects. `.claude/agents/reviewer.md:9` says CI already enforces the E2E
   suite, which now holds only into `stage` or `main`, or with the label. Changing
   either needs the owner (the D-244-28 precedent).
3. **Caches.** Only PR runs write caches now, and each is scoped to its own PR (R-241), so
   every PR's first run starts cold. A workflow on push to `dev` would warm `dev`'s cache
   for every PR into it, but it brings back a push run.
4. **Review r2's should-fix, not fixed on this branch at `9b387df`.** A draft's run
   reports the required **Lint, types and format** check skipped. After a PR is marked
   ready, it can be merged on those skips until the ready run's checks appear. A draft's
   run that starts after the ready run also cancels it, through the concurrency group.
   The reviewer proposed a name no ruleset requires for lint in a draft. Record the fix
   here once it is made.
