# #248 · CI: run only where it can catch something

- **Status:** In progress (PR #260 into `dev`, retargeted from `chore/244-stage-stack`
  once #253 merged; fix round 2 landed the owner's rulings D-248-21 and D-248-22)
- **Phase:** none (no milestone)
- **Depends on:** #6, #37, #131, #201, #244

## Task

Every push to an open PR ran all four jobs again: about 8 minutes, and 17 to 19 billed
runner minutes. PRs took 3 to 9 commits. CI now runs only where it can catch something:
on ready PRs, with lint first, the suite only for code, and E2E only into `stage` or
`main` or on request. A merge into `dev` only warms the caches. Dependabot no longer
rebases unasked. The owner set the shape on 2026-11-21 (the issue's "Decided" list).

## Decisions

### When CI runs

- **D-248-1 · CI runs on pull requests only, and the push run on `main` is gone
  (owner).** `ci.yml` triggers on `opened`, `synchronize`, `reopened` and
  `ready_for_review`. _Why:_ the `stage` → `main` promotion PR already tested the same
  tree, and Vercel deploys `main`. Changes #6's task line ("every PR and push to
  `main`"). _Research:_ R-240. _Refined by D-248-21 (owner):_ a push to `dev` runs a
  workflow that only warms caches and reports no required check.
- **D-248-2 · A draft runs no job, and marking it ready runs CI once (owner).** The lint
  job skips while `draft` is true, and every other job needs it. _Why:_ PRs take review
  fixes as drafts. ~~_Trade-off:_ the draft's skipped checks pass, and only the draft
  state stops a merge (Open question 4).~~ _Trade-off superseded by D-248-18:_ a draft's
  lint check is not a required one; what is left is in Known limits.
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
  _Research:_ R-238, R-250.
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
  _Research:_ R-240. _Extended by D-248-25:_ the cache warm-up 15.
- **D-248-13 · The E2E job caches Playwright's browsers (owner).** The cache holds
  `~/.cache/ms-playwright`, keyed by OS name and release, architecture and
  `playwright-core`'s version. On a hit, only `playwright install-deps` runs, for the
  system packages. _Why:_ the issue estimated a minute saved per run. _Trade-off:_
  Playwright advises against it, because a restore takes about as long as a download
  (R-243). A PR's own caches are its alone (R-241), so D-248-21 warms `dev`'s; a PR into
  `stage`, `main` or a feature branch still starts cold (Known limits).
- **D-248-14 · Dependabot runs monthly with `rebase-strategy: disabled`, and keeps
  `target-branch: dev` (owner).** Comment `@dependabot rebase` on a PR to update it.
  _Why:_ each rebase is a CI run, and Dependabot rebases every open PR whenever `dev`
  moves. Supersedes the weekly schedule of D-118-7 and D-131-5. _Trade-off:_ PRs opened
  before this keep being rebased for 30 days. The file is read from `main`, so the change
  waits for a promotion (as D-244-3). Security updates take none of these options
  (D-244-29), so they are still rebased. D-131's image cooldown gets one try a month
  instead of four. _Research:_ R-242, R-228.
- **D-248-15 · Every Dependabot entry adds the `e2e` label (builder; kept by the owner,
  2026-11-21).** _Why:_ Dependabot's commits never pass `.githooks/pre-push`, so a
  bump into `dev` would get no E2E before promotion, and a bump can break the running
  app. A commit made on GitHub (a web edit, **Update branch**) has the same gap. README
  asks for the label by hand there, and on a retargeted security update, which arrives
  with no labels (D-244-29). _Trade-off:_ each
  Dependabot PR still runs the full CI, as D-118-7 and D-131-5 assumed. Its label lands
  seconds after it opens, so E2E usually runs twice on its first commit, once in each
  workflow. _Research:_ R-242.
- **D-248-16 · `src/ci-runs.test.ts` plays each event through the workflows
  themselves.** The model in `test/github-actions.ts` covers only what the workflows use:
  `pull_request` triggers, push triggers on plain branch names (D-248-23), re-runs,
  `needs`, a job's `if`, name and outputs, the two scripts, and the expression syntax.
  It throws on anything else. _Why:_ Vitest cannot run GitHub, and a new construct
  should fail a test rather than be misread. _Trade-off:_ the model holds R-238 to R-240
  as they were read. Only GitHub can prove the real behaviour, after the push (the PR
  body lists the checks). _Extended by D-248-20 and D-248-23._
- **D-248-17 · CLAUDE.md's Playwright rule and README's CI section describe the triggers
  (owner).** No other CLAUDE.md rule changed. _Why:_ the issue's acceptance asks for it.

### Drafts and check names (review r2)

- **D-248-18 · On a draft's first attempt, the lint job takes a name no ruleset
  requires,** "Lint, types and format (draft, not run)". A re-run takes the required
  name, as it runs lint (D-248-11). _Why:_ a skip passes a required check (R-238). Under
  the required name, a draft's run passed Lint with nothing run, so a PR could merge on
  four skips until the ready run's lint check appeared, or after a draft's run that began
  later cancelled the ready one (review r2). A skipped job's name expression shows as
  written (R-250), which no ruleset requires either. Supersedes D-248-2's trade-off.
  _Research:_ R-238, R-250.
- **D-248-19 · A required check is skipped only under a fixed name.** Tests, the build
  and the E2E placeholder keep fixed names, and `src/ci-runs.test.ts` fails if any
  required check is skipped under an expression name. _Why:_ a docs-only or not-due run
  must pass those checks with skips (D-248-4, D-248-9), and a skipped expression name
  shows as written (R-250), so the check would stay pending. _Trade-off:_ a draft's run
  skips those three under their required names (Known limits). _Research:_ R-250.
- **D-248-20 · The model plays runs over time and cancels in progress.** `play()` starts
  each event's runs at a moment; a later run in the same concurrency group cancels a job
  still running, and the jobs that need it skip. A group without `cancel-in-progress`
  fails the parse. Extends D-248-16. _Why:_ the draft races depend on order, which one
  run at a time cannot show. _Trade-off:_ every job that runs takes one equal length, so
  it tests orderings, not durations. It evaluates a skipped job's name, unlike GitHub;
  D-248-19's test covers that.

### Fix round 2: the owner's rulings and the warm-up

From the owner's comment on #248 (2026-11-21). D-248-21 and D-248-23 to D-248-25 landed
in `970d54c`, D-248-22 in `f15c0c4`.

- **D-248-21 · A workflow on push to `dev` warms the shared caches (owner).**
  `warm-caches.yml` saves npm's cache, `.next/cache` and Playwright's browsers in `dev`'s
  scope, which every PR into `dev` can restore (R-241). Its one job, "Warm the npm,
  Next.js and browser caches", matches no required check; it has no secrets,
  `contents: read` only, checks out without credentials, and has no `pull_request`
  trigger, so no PR or draft runs it. Only `dev` is warmed. Refines D-248-1; answers Open
  question 3. _Why:_ with no post-merge run, each PR's caches are its own, so every first
  run started cold. _Trade-off:_ a PR into `stage`, `main` or a feature branch still
  starts cold (Known limits). _Research:_ R-241.
- **D-248-22 · The agent prompts follow the new CI (owner).** `.claude/agents/reviewer.md`
  no longer says CI enforces E2E on every PR: CI runs it into `stage` or `main` or with
  the `e2e` label, and the pre-push hook runs it locally before a push that changes code.
  `.claude/agents/builder.md` step 8 opens a draft, pushes later commits to it, and marks
  it ready once (`gh pr ready`), only after the run for the last pushed head commit has
  appeared (`gh run list --commit <sha> --workflow CI`). Answers Open question 2; keeps
  D-244-28. _Why:_ D-248-2 saves nothing while agents open ready PRs, and waiting for the
  push's run avoids the first draft limit below.
- **D-248-23 · The model plays a push to a plain branch name.** A `push` trigger whose
  `branches` are plain names parses; any other filter, or a schedule, fails the parse. A
  push run that reaches `ci-changes.sh` or `ci-e2e.sh` throws. Extends D-248-16. _Why:_
  the warm-up's only trigger is a push, and those scripts read a PR's files, base and
  labels, which a push has none of. `src/ci-runs.test.ts` pins that a push to `main`,
  `stage` or a feature branch starts nothing, and one to `dev` starts only the warm-up.
- **D-248-24 · A test holds the warm-up's caches to the ones the PR workflows restore.**
  For every `actions/cache` and `setup-node` step there, the warm-up has one with the same
  pinned action, `path`, `key`, `restore-keys`, `cache` and `node-version` inputs, and the
  same step naming the key. The workflows' `env` and the browsers installed must match,
  and the warm-up runs `npm ci` and `npm run build`. _Why:_ a cache's version hashes its
  path, and setup-node keys npm's cache on the OS, architecture and lockfile, so a
  warm-up that drifts saves caches no PR finds (R-251). _Trade-off:_ it checks inputs,
  not a hit; only a PR into `dev` after this merges shows one.
- **D-248-25 · The warm-up does only what fills a cache.** The browsers are looked up
  without a download (`lookup-only`) and downloaded only for a new key, without the
  system packages, which are not cached. `.next/cache` starts from the last build's
  through `restore-keys` and is rebuilt only when `src/` or the lockfile changed. No check
  or test runs. A 15-minute timeout, and a later merge cancels a warm-up still running.
  _Why:_ each cache is saved by its post step only when the job succeeds and its key is
  new (R-251), and only the newest `dev` is worth warming. _Trade-off:_ a cancelled
  warm-up saves nothing; the next one does.

## How existing decisions are handled

| Decision                             | Effect                                                                                           | By            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------- |
| #6's task line, D-06-1               | The push run is removed (owner). Lint runs first, and tests and the build skip for docs          | D-248-1, 3, 4 |
| D-37-5                               | Refined: E2E is conditional, and `e2e-catch-up.yml` holds a copy                                 | D-248-6, 8    |
| D-118-7, D-131-5                     | Weekly superseded by monthly, with no rebases (owner). The full-CI trade-off holds via the label | D-248-14, 15  |
| D-131-1                              | Extended: `ci.yml` adds `pull-requests: read`, still read-only; `warm-caches.yml` reads only     | D-248-10, 21  |
| D-131-2                              | Kept: the one `gh` call comes before checkout; the warm-up checks out without credentials        | D-248-10, 21  |
| D-131-6                              | Extended: `e2e-catch-up.yml`'s postgres too. `supply-chain.test.ts` reads every workflow         | D-248-8       |
| D-201-6, #201's "Keep CI's E2E job?" | "CI still runs the suite" superseded, and the question answered (owner). The gate is unchanged   | D-248-6       |
| D-244-2                              | Relied on: no required check is named for a draft's lint or the cache workflow's jobs            | D-248-18, 21  |
| D-244-28                             | Kept: `builder.md` keeps the branch flow; step 8 opens a draft (owner, round 2)                  | D-248-22      |
| D-244-29                             | Kept: `dependabot.yml` says security updates take none of an entry's options                     | D-248-14, 15  |
| D-244-30                             | Relied on: `main` requires the four checks, so E2E into `main` counts there                      | D-248-6       |

## Known limits

- **A retarget runs only E2E.** Lint, tests and the build are not re-run against the new
  base. Close and reopen the PR for that.
- **Every label starts a catch-up run.** Its one job is skipped. A label added before lint
  reads it runs E2E in both workflows.
- **A conflicting PR runs nothing** (R-240). With rebases off, a conflicting Dependabot
  PR shows no checks until `@dependabot rebase`.
- **Cold caches outside `dev`.** A PR into `stage`, `main` or a feature branch can
  restore only its own caches, its base's and `main`'s, and nothing runs on a push to
  those, so its first run starts cold (D-248-21, R-241).
- **A draft's run that GitHub starts after the ready run cancels it.** If the ready
  run's lint has finished, the draft's skips pass tests, the build and E2E under their
  required names (D-248-19), and the PR can merge untested. If lint is still running,
  Lint is left cancelled until a re-run, which blocks the merge. README's rule: mark a
  draft ready only once the run for its last push appears
  (`gh run list --commit <sha> --workflow CI`), and D-248-22 makes `builder.md` wait for
  it. `src/ci-runs.test.ts` pins both cases (Open question 5).
- **Reopening a PR as a draft** does the same over its last ready run's checks, until it
  is marked ready and the new run's checks appear (Open question 5).
- **Partly shown on GitHub.** #260's runs on `24406e6` (44908665916, 44908763351) match
  the model for a ready PR opened into a feature branch, then retargeted to `dev`
  (R-250). The rest of the PR body's checks, and D-248-18 itself, are still owed. The
  warm-up first runs when this PR merges into `dev`; that a PR into `dev` then restores
  its caches (D-248-24) is owed too.

## Relies on

D-06-2, D-131-1, D-131-2, D-131-3, D-131-4, D-131-6, D-201-1, D-201-6, D-201-7, D-244-1,
D-244-2, D-244-3, D-244-28, D-244-29, D-244-30.

## Open questions

1. ~~**Dependabot's `e2e` label (D-248-15)**~~ Answered (owner): kept.
2. ~~**Agent prompts are stale.**~~ Answered by D-248-22 (owner).
3. ~~**Caches.**~~ Answered by D-248-21 (owner).
4. ~~**Review r2's should-fix, not fixed on this branch at `9b387df`.**~~ Fixed by
   D-248-18 (`46384fe`); what remains is Open question 5.
5. **Accept the two draft limits?** A draft's run that GitHub starts after the ready
   run's lint, and a reopen as a draft, still pass tests, the build and E2E with skips
   (Known limits). The branch relies on README's rule and D-248-22 rather than the YAML.
   Accept them as known limits, or ask for a fix in the workflow?
