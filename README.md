# Door to Door

Mobile-first PWA for recording door-to-door visits and following them up later.

Members knock on units in a block and record what they learn — name, contact, unit number,
religion, interest level and notes. Months later the team returns and sees the full history
for that unit, so a follow-up starts from what the last person learned rather than from
nothing.

> **Status: early development.** The application shell and tooling are in place; the
> database, API and screens are being built issue by issue. Sections below marked
> _(not yet)_ describe commands that do not exist yet, and name the issue that adds them.
> Everything not marked works today.

## Features

**Members**

- Record visits against units in the block they pick from the active session
- Amend their own records during a session
- Review their own history, with the blocks and sessions they worked

**Admins**

- Create a session, attach blocks to it, and start it
- Add blocks to a session that is already running, without ending it
- End a session — and reopen one ended by mistake, so nobody loses work in progress
- View and amend every record, current and historical

**In the field**

- Installable on a phone, works offline, and syncs when signal returns _(installable: done; offline queue — #33)_

## Known limits

**Pairs cannot share records that have not synced.** Door-to-door is done in pairs, and
teammates will be able to view and edit each other's records (#74). But two phones with
no reception cannot talk to each other, so a record still waiting to sync exists on one
phone only. Its teammate sees and edits it after it has synced. The app says so on
screen; if this ever needs to change it means peer-to-peer sync between phones, which is
a different and much larger piece of work.

## Requirements

- Node.js 20+ (developed on 24)
- npm 10+
- Docker Desktop — for PostgreSQL

## Quick start

```bash
git clone https://github.com/alphonsekoh/door-to-door.git
cd door-to-door
docker compose up
```

Open http://localhost:3000. That is the whole setup — Compose starts PostgreSQL, waits for
it to be healthy, applies migrations, seeds demo data, then starts the dev server. Editing a
source file hot-reloads in the container.

| Service   | Port | What it is                                           |
| --------- | ---- | ---------------------------------------------------- |
| `web`     | 3000 | Next.js dev server                                   |
| `db`      | 5432 | PostgreSQL, persisted in a named volume              |
| `db-test` | 5433 | Scratch database for integration tests, tmpfs-backed |
| `migrate` | —    | Runs migrations and the seed once, then exits        |

`web` waits for `migrate` to complete successfully, so the app never starts against an
unmigrated database.

```bash
docker compose down -v    # tear down, including data
docker compose up         # back to a freshly seeded install
```

### Without Docker

```bash
npm install
npm run dev
```

You will need a PostgreSQL instance of your own, a `config.yaml` and the credential
variables; see [Configuration](#configuration) and [Database](#database).

## Scripts

| Script                 | What it does                      |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Start the dev server on port 3000 |
| `npm run build`        | Production build                  |
| `npm start`            | Serve a production build          |
| `npm run lint`         | ESLint (type-aware)               |
| `npm run lint:fix`     | ESLint with autofix               |
| `npm run typecheck`    | `tsc --noEmit`                    |
| `npm run format`       | Prettier write                    |
| `npm run format:check` | Prettier check, no writes         |

| `npm test` | Unit and component tests (no database needed) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:unit` | Unit project only |
| `npm run test:integration` | Integration tests (**requires `TEST_DATABASE_URL`**) |
| `npm run test:all` | Every project |
| `npm run test:components` | Component project only |
| `npm run test:coverage` | Run tests and enforce coverage thresholds |
| `npm run test:e2e` | Three end-to-end flows in a real browser (**needs the `db-test` container**) |
| `npm run test:e2e:ui` | The same suite in Playwright's UI mode |

| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema straight to the database (dev only) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:seed` | Seed deterministic demo data |
| `npm run db:reset` | Migrate then seed |

| `npm run spec:lint` | Lint `openapi.yaml` |
| `npm run spec:preview` | Browse the API docs locally |

| `npm run generate:api` | Regenerate types and Zod schemas from the contract |

## Configuration

App settings live in a YAML file, read when the server starts and never bundled into the
build. Change a value, restart, done: no rebuild. Copy
[`config.example.yaml`](config.example.yaml) to `config.yaml` (git-ignored) and edit it;
every key is documented in the example. Unknown keys are errors, so a typo cannot silently
fall back to a default.

| Key                              | Default | Meaning                                                       |
| -------------------------------- | ------- | ------------------------------------------------------------- |
| `database.url`                   | -       | Connection URL **without** username or password               |
| `auth.trustHost`                 | `true`  | Trust the `Host` header from a reverse proxy                  |
| `auth.google.clientId`           | unset   | Google SSO client ID (public). Omit to leave SSO off          |
| `rateLimit.signInAttempts`       | `10`    | Sign-in attempts per email within the window                  |
| `rateLimit.signInWindowSeconds`  | `300`   | Length of that window                                         |
| `sync.clockSkewToleranceSeconds` | `300`   | Tolerated difference between a phone's clock and the server's |

Numbers must be whole and at least 1.

### Secrets are not in the file

The server refuses to start if `database.url` contains a username or password. Secrets come
from the environment. Each also has a `_FILE` variant naming a file to read it from (a
trailing newline is dropped), which is how Docker and Kubernetes secrets arrive. Set one or
the other, not both.

| Variable                             | Used for                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `DATABASE_USER`, `DATABASE_PASSWORD` | Added to `database.url` (percent-encoded for you)                                                  |
| `AUTH_SECRET`                        | Signs session cookies. At least 32 random characters, not a placeholder: `openssl rand -base64 32` |
| `AUTH_GOOGLE_SECRET`                 | Google client secret; required once `auth.google.clientId` is set                                  |

### Other environment variables

| Variable            | Meaning                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `CONFIG_PATH`       | Where the file is. Default `./config.yaml`; `/app/config.yaml` in the image |
| `PORT`, `HOSTNAME`  | Where the server listens (standalone build)                                 |
| `NODE_ENV`          | Set by Next; `production` in the image                                      |
| `TEST_DATABASE_URL` | Tests only: a full URL, credentials included, for the scratch database      |

A `.env` file is no longer read for settings. If one is present the server says so at startup.

### Changing a value in production

Edit the file, then restart. The settings file is not part of the image:

```bash
docker run -p 3000:3000 \
  -v ./config.yaml:/app/config.yaml:ro \
  -e DATABASE_USER -e DATABASE_PASSWORD -e AUTH_SECRET \
  door-to-door
```

The container runs as uid 1001, so the file must be readable by it (`chmod 644`, or `chown
1001`). A bad file, a missing secret or a placeholder `AUTH_SECRET` stops the server at
startup with a message naming the file and the key, never the value.

`docker compose up` mounts `config.docker.yaml` (database host `db`) and passes throwaway
local credentials. Point it at another file with `CONFIG_FILE=./config.yaml docker compose up`.

## Database

```bash
cp config.example.yaml config.yaml    # then set database.url
export DATABASE_USER=postgres DATABASE_PASSWORD=postgres
npm run db:migrate            # apply migrations
npm run db:seed               # load demo data
```

### Seeded logins

Development only. The seed is deterministic and idempotent — re-running it changes nothing.

| Email               | Role   | Password      |
| ------------------- | ------ | ------------- |
| `admin@example.com` | admin  | `password123` |
| `alice@example.com` | member | `password123` |
| `ben@example.com`   | member | `password123` |
| `cara@example.com`  | member | `password123` |

It creates four blocks, two ended sessions with visits across them, a draft session ready to
start, and follow-up notes both outstanding and resolved. Several units are visited twice so
the history screens have a real trajectory to show — `123 #05-123` goes from `low` to
`medium` between March and June.

Migrations live in `drizzle/` and are **always generated**, never hand-written:

```bash
# edit src/db/schema.ts, then:
npm run db:generate -- --name describe_the_change
npm run db:migrate
```

Never edit a migration that has been applied — add a new one. Drizzle records what it has
run, so `db:migrate` is safe to re-run.

## Project structure

```
src/
  app/          routes; app/api/** holds route handlers
  components/   React components
  lib/          framework-free helpers
  server/       server-only services and data access
  db/           Drizzle schema and client
  generated/    generated from openapi.yaml - never edit by hand
drizzle/        generated migrations - never edit by hand
```

## Testing

```bash
npm test               # unit + components, no database required
npm run test:integration   # needs TEST_DATABASE_URL, e.g. postgresql://postgres:postgres@localhost:5433/door_to_door_test
npm run test:coverage      # everything, with thresholds enforced
```

`npm test` deliberately excludes integration tests so the common case stays fast and
offline. Integration tests fail loudly when `TEST_DATABASE_URL` is unset rather than skipping —
a suite that quietly runs nothing is worse than one that does not run.

### End-to-end

```bash
docker compose up -d db-test    # the scratch Postgres the suite seeds into
npm run test:e2e
```

Playwright builds the app, serves the standalone output and drives three flows at a
phone viewport: signing in, recording a visit, and an outing from draft through end to
reopened. It creates and reseeds its own `door_to_door_e2e` database on the scratch
server, so it never disturbs the integration suite.

It is deliberately thin — Vitest owns coverage. This layer exists for what jsdom cannot
see: layout, stacking order and client-side navigation. Its first real run caught a
sign-in that set the session cookie and then left the member on the sign-in page, in the
production build only.

Vitest runs three projects — `unit` (node), `integration` (node, against a real PostgreSQL
once #7 lands) and `components` (jsdom + Testing Library). Test files are picked up by
suffix: `*.test.ts` is a unit test, `*.integration.test.ts` an integration test, and
`*.test.tsx` a component test.

Coverage is enforced per-glob: **100%** for `src/server/**`, `src/lib/**`, `src/app/api/**`
and `src/db/**`; **90%** for `src/components/**` and `src/app/**`. Generated output,
migrations and `layout.tsx` are excluded.

## CI

Every push to `main` and every pull request runs three jobs:

| Job        | Checks                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| **Static** | lint · typecheck · format · migrations match the schema                                 |
| **Tests**  | unit, component and integration tests against a real PostgreSQL, then the coverage gate |
| **Build**  | production `next build`                                                                 |

The migration drift check regenerates from the schema and fails if anything changed — so a
schema edit without a committed migration, or a hand-edited migration, turns CI red.

## How the API is built

[`openapi.yaml`](./openapi.yaml) is the source of truth. Types, Zod validators and the
Zod validators are generated from it with `@hey-api/openapi-ts` into `src/generated`; CI
regenerates on every push and fails if the result differs, so neither a stale spec change
nor a hand-edited generated file can slip through.

Only types and validators are generated — the SDK/client plugins are off because their HTTP
runtime does not satisfy `exactOptionalPropertyTypes`. Call the API with `fetch`, typed and
validated by the generated output.

Run `npm run spec:preview` to browse the documented API. CI lints the spec on every push,
and a test asserts its enums match the Drizzle `pgEnum` values exactly — a value valid in
one layer but not the other would otherwise pass both in isolation. Every route handler validates both its request **and its
response** against the contract, so a response that diverges fails a test rather than
shipping.

The workflow is: **edit the spec → regenerate → implement.** Never the other way round.

## Contributing

Read [CLAUDE.md](./CLAUDE.md) — it holds the domain model and the working rules, each
marked as CI-enforced or convention.

Branches are stacked: a feature branch bases off the previous one and its PR targets that
branch rather than `main`. Merge top-down, and squash or rebase rather than creating a
merge commit.
