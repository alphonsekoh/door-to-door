# #244 · Stage environment: a production-like Docker stack

- **Status:** In progress (branch `chore/244-stage-stack`, not yet a PR)
- **Phase:** none (no milestone)
- **Depends on:** #5, #124, #131, #241

## Task

The owner added two protected branches on 2026-11-21: `dev` for features and `stage` for
the release candidate, which is tested before it is merged to `main` and Vercel deploys it.
Production is the Next.js build on Vercel with settings from `CONFIG_YAML`, and PostgreSQL
17 on Neon (ap-southeast-1). This adds a stack shaped like that, a year of records to
load into it, and a check that measures it, with or without a far database.

## Decisions

### Branch flow

- **D-244-1 · `dev` takes features, `stage` the release candidate, `main` production
  (owner, 2026-11-21).** A feature PR, or the first branch of a stack, targets `dev` and
  is squashed or rebased. `dev` is promoted to `stage`, and `stage` to `main`, each by a
  merge commit. Nothing flows back: a fix goes to `dev`. _Why:_ a squashed or rebased
  promotion gives `dev` and `stage` the same changes under different commits, and every
  later promotion then conflicts.
- **D-244-2 · What the rulesets enforce (read 2026-11-21).** `dev`: a PR, squash or
  rebase only, the four checks (Lint, types and format; Tests and coverage; End-to-end
  smoke; Production build). `stage`: a PR, merge commits only, the four checks. Both refuse
  deletion and force-pushes. `main` is held only by "D2D Branch Rule" (default branch,
  `dev`, `stage`), which requires a PR and refuses deletion and force-pushes, with any
  merge method and no checks. The ruleset named `main` targets no branch. _Why:_ recorded
  so a later task knows which part of D-244-1 is enforced and which is convention (Open
  questions).
- **D-244-3 · Dependabot's four entries set `target-branch: dev`.** _Why:_ a bump merged
  into `main` would reach production without passing through `dev` and `stage`.
  _Trade-off:_ Dependabot reads its config from the default branch, so the change takes
  effect only once it reaches `main`. Security updates ignore `target-branch` and still
  open against `main`, and none of the entry's options apply to them (Open questions).
  _Research:_ R-228.
- **D-244-4 · Scope cut: CLAUDE.md and `.claude/agents/builder.md` are not changed.**
  _Superseded by D-244-28._
  README gains Branches and its Contributing paragraph follows D-244-1. CLAUDE.md's
  Commits rule and the builder's branch and PR steps still describe the old flow. _Why:_
  the builder and reviewer held that changing either needs the owner's say-so, not an
  agent's (Open questions).
- **D-244-28 · CLAUDE.md and `.claude/agents/builder.md` follow D-244-1 (owner, 2026-11-21).**
  CLAUDE.md's Commits rule: the first branch of a stack bases off and targets `dev`, later
  ones target the branch before them, never `stage` or `main`; squash or rebase into `dev`,
  where the phantom-conflict warning now applies; only promotions are merge commits, and
  nothing flows back. `builder.md` steps 1 and 8 base a lone branch on `dev` and open its
  PR there. _Why:_ the owner chose this flow with the note that CLAUDE.md and the
  pipelines switch their base to `dev`; the text is the builder's proposal, unchanged.
  Supersedes D-244-4 and resolves Open question 2.

### The stack

- **D-244-5 · Its own Compose file and project.** `docker-compose.stage.yml`, project
  `door-to-door-stage`, its own volumes (`pgdata`, `secret`, `caddy`) and network. Only
  the edge (`127.0.0.1:3400`) and toxiproxy's API (`127.0.0.1:3401`) are published, and
  `db` is published nowhere. Every `stage:*` Compose script names that project and file,
  and `stage:down` is `down -v`. _Why:_ it never touches the dev stack, the test
  databases or their ports. It applies D-124-6.
- **D-244-6 · `app` is the Dockerfile's `runner` stage, unchanged, with settings from
  `CONFIG_YAML` and `CONFIG_PATH: ""`.** The settings are `secureCookies: true`,
  `trustHost: true` and `trustedProxyHops: 1`, with no Google sign-in. _Why:_ production
  reads `CONFIG_YAML`. The image's own `CONFIG_PATH` beside it refuses to start (D-241-2).
  Google needs a real OAuth client.
- **D-244-7 · A Caddy edge with `tls internal` stands in for Vercel's proxy.** It has its
  own certificate authority, kept out of the machine's trust store (`skip_install_trust`),
  and no redirect port. It sets `X-Forwarded-For` from the client and ignores incoming
  values. _Why:_ the `__Secure-` and `__Host-` cookies need HTTPS in every browser, and
  one proxy that writes the header makes `trustedProxyHops: 1` true, as on Vercel
  (D-120-5). _Research:_ R-226.
- **D-244-8 · The edge strips the app's `Strict-Transport-Security`.** _Why:_ a browser
  that trusts the stage certificate would pin every `localhost` port to HTTPS for D-122-5's
  two years, the dev server's included. Production still sends it, and D-122-5's "local
  runs are unaffected" still holds.
- **D-244-9 · The edge compresses responses (`encode zstd gzip`).** _Why:_ the app sends
  its API JSON uncompressed, and Vercel's edge compresses it. Without `encode`, a
  `/api/history` page went out at 126.6 KB, and through the edge at about 11 KB.
  _Research:_ R-230.
- **D-244-10 · toxiproxy, not `tc netem`, carries every app query to `db`.**
  `--db-latency <ms>` adds a latency toxic on each direction, half each way, through its
  API, and the check removes it when it ends. `migrate` and `seed` connect to `db`
  directly. _Why:_ it needs no `NET_ADMIN` and no package in the postgres image, and the
  delay is switched on and off without a restart. A toxic delays one direction only.
  Bypassing it means an injected delay never slows a migration or the load.
  _Research:_ R-227.
- **D-244-11 · `AUTH_SECRET` comes from a one-shot `secret` service.** It is
  `STAGE_AUTH_SECRET` from the shell when set. Otherwise it is 32 random bytes as 64 hex
  characters, made once into the `secret` volume, mode 400 for uid 1001. `app` reads
  `AUTH_SECRET_FILE`. `${VAR:?}` is not used. _Why:_ no secret is committed, a restart
  keeps everyone signed in, and `stage:down` deletes it. Hex cannot match the placeholder
  pattern (D-75-6). `${VAR:?}` would fail every Compose command, as D-124-7 found.
- **D-244-12 · `migrate` runs the real runner (`npm run db:migrate`) from the
  Dockerfile's `dev` stage, and `app` waits for it and `secret` to succeed.** _Why:_ the
  runner image has neither the migration runner nor `tsx`. This follows D-05-1.
- **D-244-13 · `db` is the dev stack's `postgres:17-alpine` digest, and
  `src/stage-stack.test.ts` holds the two equal.** `supply-chain.test.ts` also holds every
  stage image to a digest (toxiproxy 2.12.0, caddy 2.11). Extends D-131-4 and D-131-6.
  _Why:_ the two stacks move together. Dependabot's `docker-compose` entry reads
  `docker-compose.stage.yml` too, so its digests are kept current, and the test catches a
  bump that moves only one postgres. _Research:_ R-228.
- **D-244-14 · `app` gets 1 CPU and 2 GB.** _Why:_ a Vercel function's default size.
  _Research:_ R-229.
- **D-244-15 · `.dockerignore` excludes `/docker`.** _Why:_ the stack mounts the
  Caddyfile and toxiproxy's settings at runtime. In the build context, an edit to either
  would only rebuild the app.

### The seed

- **D-244-16 · `npm run stage:seed` has two guards and no typed flag.** It first prints
  `Stage seed target: host:port/database` (as D-124-3). It then refuses, writing nothing:
  - a database not named exactly `door_to_door_stage`
  - one holding any row in `users`, `blocks`, `outing_sessions`, `households`, `visits`
    or `follow_ups`

  _Why:_ the script's URL and credentials are Compose literals that reach only the stack's
  `db`, and production's database is never given that name.

  This departs from D-124-1's typed `--demo` on purpose. D-124-1 governs `db:seed`, and
  here the name does what the flag does there: it refuses a new, empty production
  database. The emptiness check is stricter than D-124-2, which lets the demo seed's own
  users through. _Trade-off:_ a database someone names `door_to_door_stage` passes the
  first guard.

- **D-244-17 · The name guard sits in `runStageSeedCli`, and the emptiness check inside
  `seedStageDatabase`'s transaction.** _Why:_ the integration test loads the test database
  through `seedStageDatabase`. Unlike D-124-2's guard, which covers every caller, a direct
  caller of `seedStageDatabase` skips the name check. The only callers are the script and
  that test.
- **D-244-18 · The year is generated and the password hashed before the emptiness
  check.** This is unlike D-124-14's order for `db:seed`. _Why:_ the check runs in the
  load's transaction, so nothing can land between it and the load. A refusal by name
  still does no work. _Trade-off:_ refusing a database that holds data costs one
  generation and one argon2 hash.
- **D-244-19 · One transaction in 1,000-row chunks, then `ANALYZE`.** _Why:_ a failed load
  leaves the database empty, so the next run is not refused. The chunks stay under
  Postgres's bind-parameter limit (R-131). `ANALYZE` gives the planner the statistics a
  long-used database would have.
- **D-244-20 · The shape of the year.**
  - 30 blocks of 80 to 120 units.
  - 48 weekly door-to-door sessions of 4 blocks, at 75% coverage.
  - 4 follow-up sessions, one session active (begun 90 minutes earlier) and one draft.
  - Follow-ups in every state, removed ones included.
  - 3 admins and 40 members, the last 2 deactivated 60 days ago.

  That made 2,965 households, 14,461 visits and 1,268 follow-ups. Every login uses the
  published password `stage-password`: `admin@stage.example.com`, and
  `member01@stage.example.com` to `member38@stage.example.com`. The data is a pure module
  (`stage-seed-data.ts`), as D-09-4. _Why:_ enough rows that a query which is cheap on the
  demo seed shows its cost.

- **D-244-21 · Deterministic: mulberry32, seed 244, ids UUIDv7 from the same draws.** The
  same `now` gives the same records. Any `now` gives the same counts: four moments over
  three weeks matched, checked by the docs step. _Why:_ two freshly seeded stacks compare
  like with like, which `Math.random` would not give.

### The check

- **D-244-22 · `npm run stage:perf` measures latency, not load.** It makes one request at
  a time: 20 rounds after 2 warm-up rounds by default. Each round does a member's and then
  an admin's screens, a page (`accept: text/html`) and then its API reads, in a phone's
  order. _Why:_ the pages are server-rendered shells that read their data from the API
  after loading, so a screen costs its page plus those reads.
- **D-244-23 · Each round signs in the next member, `member01` to `member38` in turn.**
  A refusal shows in `failed` with its status. _Why:_ `POST /visits` allows 30 saves a
  minute per member (D-126-8). With one member, 14 of 20 saves were refused (R-230).
- **D-244-24 · It reports p50, p95 and max (nearest rank), and the median size decoded
  and as sent.** The output is a Markdown table, or JSON with `--json`. Its client is
  `node:http`, not `fetch`. _Why:_ `fetch` decompresses out of sight, and a phone on
  mobile data pays for the size as sent.
- **D-244-25 · TLS is verified against the edge's own root certificate.** The check reads
  it from the edge's volume with `docker compose exec`, and never turns verification off.
  _Why:_ the check talks to the stack the way a phone would, and nothing on the machine
  has to trust the certificate.

### Variables, code and tests

- **D-244-26 · `STAGE_PORT`, `STAGE_TOXIPROXY_PORT` and `STAGE_AUTH_SECRET` are Compose
  and tooling variables that the app never reads.** They fall outside D-75-7 and D-124-9's
  "no new variable", like `CONFIG_FILE` and `E2E_PORT`. D-75-7 governs what the app and
  its scripts read as settings. _Why:_ they move the stack's ports and supply its secret,
  and no setting changes with them.
- **D-244-27 · The logic is in `src/db/stage-seed*.ts` and `src/server/stage/`, under
  the 100% threshold.** `scripts/stage-seed.ts` and `scripts/stage-perf.ts` are glue.
  `src/stage-stack.test.ts` holds the Compose file, the npm scripts and README's Stage
  environment and Branches sections to these decisions, as D-124-12 does for the dev
  stack. _Why:_ CI's unit job cannot run Compose (D-131-6's precedent). This follows
  D-09-4 and D-124-4.

## How existing decisions are handled

| Decision          | Effect                                                                                          | By           |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------ |
| D-124-1, D-124-2  | Kept for `db:seed`; the stage seed guards differently, on purpose                               | D-244-16, 17 |
| D-124-14          | Kept for `db:seed`; the stage seed hashes before its emptiness check                            | D-244-18     |
| D-124-7           | Applied: no `${VAR:?}`; the runner still refuses the dev secret                                 | D-244-11     |
| D-75-7, D-124-9   | Scope stated: Compose and tooling variables are outside                                         | D-244-26     |
| D-122-5           | Kept: production sends HSTS; the stage edge drops it                                            | D-244-8      |
| D-131-4, D-131-6  | Extended to the stage file's images and its postgres                                            | D-244-13     |
| D-118-7, D-166-11 | **Conflict, open:** with `target-branch` set, security updates take none of the entry's options | D-244-3      |
| CLAUDE.md Commits | Rewritten for D-244-1 (owner)                                                                   | D-244-28     |

## Known limits

- **Not modelled:** Vercel's cold starts and edge network, the distance from a phone to
  the edge, Neon's scale-to-zero, TLS and pooler, Google sign-in, many phones at once,
  mobile networks, and the browser's own work (README, Stage environment).
- **The check grows the data.** Each round records a visit.
- **The Dependabot change waits for `main`** (D-244-3). Until a promotion carries it
  there, version updates still open against `main`.
- **A self-hosted image with no compressing proxy** sends about 125 KB per `/api/history`
  page (D-244-9). Compressing in the app is not in this issue.
- **Possible follow-up issue:** behind the edge, `/api/auth/csrf` sets a second
  `__Host-authjs.csrf-token` cookie whose `callback-url` is `https://0.0.0.0:3000`, the
  bind address, not the forwarded host (builder, R-230). It does no harm today:
  password sign-in passes `redirect: false`, and Google passes `redirectTo`. Production's
  headers are worth checking.

## Relies on

D-05-1, D-09-4, D-13-4, D-75-6, D-75-7, D-120-5, D-122-5, D-122-12, D-124-1, D-124-2,
D-124-3, D-124-6, D-124-7, D-124-12, D-124-14, D-126-8, D-131-4, D-131-5, D-131-6,
D-241-1, D-241-2.

## Open questions

1. **Dependabot security updates against D-118-7 and D-166-11 (conflict).** Once
   `target-branch` is set, GitHub applies none of the entry's options to security
   updates (R-228). Those options are its groups, ignores, labels and commit prefix.
   - D-118-7 reads: "npm has three groups: security, minor-and-patch, major". Its
     `npm-security` group would no longer group anything.
   - D-166-11 reads: "These two ignores hold back security updates too". That would no
     longer be true.

   If both stand with D-244-3, each security fix opens on its own against `main`, without
   the `chore` prefix or labels, and may propose a TypeScript major that cannot install.
   The `dependabot.yml` comment mentions only the base; the docs step added the rest to
   README's Branches. Nothing breaks today, because security updates are off
   (`automated-security-fixes`: `enabled: false`). Options:
   - (a) Accept this, and supersede the security parts of D-118-7 and D-166-11.
   - (b) Make `dev` the default branch, drop `target-branch`, and name `main` in "D2D
     Branch Rule".
   - (c) Keep security updates off.

2. **Resolved (owner, 2026-11-21): applied as D-244-28.** CLAUDE.md and `.claude/agents/builder.md` (D-244-4). The builder proposed new text:
   - **CLAUDE.md Commits.** The first branch of a stack bases off and targets `dev`, and
     each later branch targets the one before it, never `stage` or `main`. Merge top-down,
     squashing or rebasing into `dev`. The phantom-conflict warning moves from `main` to
     `dev`. Only promotions are merge commits, and nothing flows back.
   - **`builder.md`.** Step 1 bases off `dev` when no branch is open. Step 8 uses
     `--base <parent branch>`, which is `dev` for the first branch.

3. **`main`'s protection (D-244-2).** "D2D Branch Rule" requires a PR on `main` but none
   of the four checks, and allows squash and rebase. So a PR opened against `main` by
   mistake could reach production without CI, and a squashed promotion breaks D-244-1.
   Requiring the checks and merge-only on `main` would close both.
