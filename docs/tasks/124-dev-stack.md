# #124 · Keep the dev stack out of production

- **Status:** In progress
- **Phase:** 7 - Hardening
- **Depends on:** #5, #9, #16, #75, #122

## Task

The last open item of the 2026-10-28 security audit (#133). The seed ran anywhere and
added a known admin login, Compose's public `AUTH_SECRET` was accepted in production,
Compose published its ports on every interface, and no dev server checked `Host`, so a
DNS-rebound page could sign in as the seed admin. No contract, schema or UI change.

## Decisions

### Seed

- **D-124-1 · `db:seed` runs only with `--demo` typed; no npm script passes it.**
  `npm run db:seed -- --demo`, or `db:reset -- --demo`. _Why:_ on a new production
  database with no users yet, the flag is the only guard, so it is typed each time.
  _Research:_ R-173.
- **D-124-2 · `seedDatabase()` refuses, before any write, a database whose `users` holds
  any id outside the seed's fixed ids.** A `SeedRefusedError`, exit 1, naming no
  account. Extends D-09-5. _Why:_ in `seedDatabase()` it guards every caller (CLI,
  `db:reset`, Compose `seed`, E2E). The seed's own users still pass, so a re-run
  changes nothing, and E2E passes because global setup truncates first.
- **D-124-3 · The CLI's first line is `Demo seed target: host:port/database`, before the
  flag check, never the credentials.** _Why:_ a refusal says which database it was about
  (D-75-5). _Wording refined (owner, 2026-11-13, nit 4):_ it read
  `Seeding demo data into …`, claiming a seed the next check could refuse. The README's
  Seeded logins paragraph quotes the new line.
- **D-124-4 · The guard is `src/db/seed-guard.ts`; `scripts/seed.ts` stays glue.**
  _Why:_ 100% coverage there; keeps D-09-4.

### Compose

- **D-124-5 · `migrate` only migrates; a one-shot `seed` service runs
  `db:seed -- --demo` once `migrate` succeeds, and `web` waits on `migrate` alone
  (owner, 2026-11-13, Q3 (a)).** Plain `docker compose up` still seeds. The README says
  production migrations use `docker compose run --rm --no-deps migrate`, never `up`.
  Refines #5's "migrate-and-seed once"; keeps D-05-1. _Why:_ `run migrate` then adds no
  login anywhere, and a seed refused on a dev database with users never holds the dev
  server. _Trade-off:_ `up` against a new, empty database still seeds it. _Rejected:_ a
  `demo` profile, which would make the quick start an empty app needing `create-admin`.
- **D-124-6 · Every Compose port is published on `127.0.0.1`.** _Why:_ the credentials
  are public. _Trade-off:_ a phone on the LAN no longer reaches Compose, so
  `config.docker.yaml`'s `secureCookies: false` now serves Safari on `localhost`
  (D-122-12 unchanged).
- **D-124-7 · Compose keeps its `AUTH_SECRET` literal, and an `AUTH_SECRET` matching
  `/not.?for.?production/i` is refused unless `NODE_ENV` is `development` (owner,
  2026-11-13, Q1 (a)).** It fails closed: unset and `test` are refused. Production
  refuses it at start through D-75-10. Extends D-75-6; refines D-75-19, whose "the dev
  secret is not sensitive" now holds only under `next dev`. _Why:_ the quick start stays
  zero-config, and the standalone server forces `production`, so the public value can
  never sign a deployed session. CI's E2E secret does not match. _Rejected:_
  `${AUTH_SECRET:?}`, which fails every Compose command, `up -d db-test` and
  `run migrate` included. _Research:_ R-170, R-171.

### Dev server

- **D-124-8 · Under `next dev` only, the proxy's first step answers `403 forbidden`,
  `no-store`, to any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`
  (any port) (owner, 2026-11-13, Q2 (a)).** It runs before the PWA paths, Auth.js and
  the settings file, and reads `Host` only, never `X-Forwarded-Host` or `request.url`.
  The check lives only in the proxy. It is a network guard for the dev server, not
  authorization, so D-16-2 holds; it refines D-16-1's "redirect only". _Why:_ a
  DNS-rebound page sends its own name as `Host`, and a page can set
  `X-Forwarded-Host`. Binding to loopback does not stop rebinding. A production build
  drops the branch. _Research:_ R-98, R-169, R-170.
- **D-124-9 · One `LOOPBACK_HOSTS` list in `src/server/http/dev-hosts.ts` feeds the
  proxy and `allowedDevOrigins`; there is no config key or env var.** _Why:_ the two dev
  guards agree. D-121-5 refused a host key, and D-75-7 allows no new variable.
- **D-124-10 · `npm run dev` binds `127.0.0.1`; the Dockerfile dev stage runs the
  installed `next dev -H 0.0.0.0` (D-124-19) (owner, 2026-11-13, Q2 (a)).** To try the
  app on a phone over the LAN, use the production build, on a network you trust
  (D-124-21). _Why:_ the bind address is the only thing that keeps Next's own dev
  endpoints, which the proxy never sees, off the LAN. In a container, only `0.0.0.0`
  receives the published port, which D-124-6 puts on the host's loopback. _Rejected:_
  an opt-in dev host list, a new setting that `next.config.ts` would read at start.
  _Research:_ R-172.
- **D-124-11 · No contract change.** _Why:_ a production build never serves the dev
  `403`, and the contract describes the deployed API (D-10-1).

### Tests and docs

- **D-124-12 · `src/dev-stack.test.ts` holds `docker-compose.yml`, `package.json`, the
  Dockerfile's dev stage, `README.md` and `config.docker.yaml` to D-124-1, D-124-5,
  D-124-6, D-124-7, D-124-10, D-124-19, D-124-20 and D-124-21.** Every `CONFIG_FILE=`
  before `docker compose run --rm --no-deps migrate` names exactly `./config.yaml`,
  before `docker compose up` exactly `./config.demo.yaml`, and every README section with
  `HOSTNAME=0.0.0.0` carries the seeded-logins warning. _Why:_ Compose cannot run in
  CI's unit job (D-131-6 precedent), and the README is where an operator copies the
  command from.
- **D-124-13 · `isLoopbackHost` takes only a bare `host[:port]`.** Parsed as
  `http://<Host>`, the header must serialise back to exactly its origin, so userinfo
  (`evil.test@localhost`), a path, a query or a fragment is refused.
  _Why:_ the hostname alone lets `evil.test@localhost` through, and no browser sends
  such a `Host`.
- **D-124-14 · The users check runs before the argon2 hash.** _Why:_ a refusal does no
  work at all.
- **D-124-15 · The Compose `migrate` and `seed` commands are in array form, not
  `sh -c`.** _Why:_ no shell parses them, and the test compares them exactly.
- **D-124-16 · `--demo` must be the only argument.** `--demo=true`, `-x --demo`,
  `--demo -x` and typos are refused with the usage line. _Why:_ a typo or an extra
  argument must never seed by falling through (D-124-1).
- **D-124-17 · The README says that for `compose run migrate`, the settings file's
  `database.url` must name a host the container can reach, not `localhost`.** _Why:_ in
  the container `localhost` is the container, and `--no-deps` starts no `db`.
- **D-124-18 · The Compose test pins more than the plan asked.** The exact published
  port list (a new port fails too), the exact `migrate` and `seed` commands, `seed`
  waiting on `migrate`'s success, `web`'s `depends_on` being exactly `migrate`, `web`
  having no `command` (so the Dockerfile's `-H 0.0.0.0` runs), and the secret being a
  shell-overridable `${AUTH_SECRET:-…}`. It reads the file with YAML merge keys
  resolved, as Compose does. _Why:_ each is a way the file could drift that the plan's
  checks would miss. _Research:_ R-174.

### Reviewer nits (owner, 2026-11-13)

The owner ruled that the four nits left open on PR #179 are fixed on this PR, and that
Q1 (a), Q2 (a) and Q3 (a) stand as recorded (D-124-7; D-124-8, D-124-10; D-124-5).
Nit 4 is D-124-3's wording; the others follow.

- **D-124-19 · The Dockerfile dev stage runs `node_modules/.bin/next`, never `npx next`
  (nit 1).** _Why:_ with no TTY, `npx` installs a package missing from `node_modules`
  from the registry without asking, so a missing binary would run an unpinned `next`;
  the installed path fails instead. _Research:_ R-175.
- **D-124-20 · A changed Compose settings file is a copy named `config.demo.yaml`, never
  `config.yaml` (nit 2).** The README and `config.docker.yaml`'s header give
  `CONFIG_FILE=./config.demo.yaml docker compose up`; production's
  `docker compose run --rm --no-deps migrate` keeps `./config.yaml`. The existing
  `/config.*.yaml` (`.gitignore`) and `config.*.yaml` (`.dockerignore`) rules already
  keep the copy out of git and every image (D-75-1, D-106-3). _Why:_ under one name, an
  operator following the demo line with their production file runs `next dev` and the
  seed against production, and the seed refuses only once users exist (D-124-2).
- **D-124-21 · Every README section that runs the app with `HOSTNAME=0.0.0.0` warns that
  anyone on that network can sign in with the seeded logins, so run it only on a network
  you trust, or against a database without the seed users (nit 3).** _Why:_ D-124-10
  sends LAN phone testing to the production build, which nothing keeps on loopback, and
  the seed's password is public (D-09-5). _Trade-off:_ a warning, not a guard; the
  production build serves whatever logins its database holds.

## Known limits

- **Next's own dev endpoints skip the Host check.** `/_next/*` and `/__nextjs*` are
  answered by Next's guard before the proxy runs, and that guard passes a request with
  no `Origin`, so a rebound page's GET reaches them (`/_next/static` answers `200`).
  The matcher's excluded paths (`/_next/static`, `/_next/image`, `favicon.ico`, image
  files) skip it too. They serve compiled source and public files, not data or a
  session, and D-124-10 keeps them off the LAN. Closing the gap needs a custom dev
  server (R-169).
- **`docker compose up` against a new, empty database seeds it** (D-124-5). Only the
  README and `--no-deps migrate` stand in the way.
- **Not run here (no Docker):** `docker compose ps` showing every port on `127.0.0.1`;
  `compose run migrate` and `run seed` on a database with real users; a fresh `up` that
  seeds, starts `web` through `node_modules/.bin/next` (D-124-19) and signs in, with
  `web` still up when `seed` refuses. The owner runs these.

## Relies on

D-05-1, D-05-3, D-09-2, D-09-4, D-09-5, D-10-1, D-13-4, D-16-2, D-32-19, D-75-1,
D-75-5, D-75-7, D-75-9, D-75-10, D-106-3, D-121-5, D-122-1, D-122-12, D-131-6.

## Open questions

None for the agents. Before merging, the owner confirms that `.env.example` holds
placeholders only and that its `AUTH_SECRET` placeholder is refused by
`PLACEHOLDER_PATTERN`; agents cannot read the file. No change to it is needed: #124 adds
no variable.
