# Door to Door

Mobile-first PWA for recording door-to-door visits and following them up later.

Members knock on units in a block and record what they learn: name, contact, unit number,
religion, interest level and notes. Months later the team returns and sees the full history
for that unit, so a follow-up starts from what the last person learned rather than from
nothing.

| Session                                         | Recording                                      | Block units                              | History                                      | Admin                                                |
| ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| ![Active session](docs/screenshots/session.png) | ![Record a visit](docs/screenshots/record.png) | ![Unit list](docs/screenshots/units.png) | ![Own history](docs/screenshots/history.png) | ![Admin session](docs/screenshots/admin-session.png) |

_Screenshots are of the seeded demo data at phone width (393 px); none of it is real._

## Contents

- [Features](#features) · [Known limits](#known-limits)
- [Getting started](#getting-started): [with Docker](#quick-start-with-docker),
  [without Docker](#quick-start-without-docker), [record your first visit](#record-your-first-visit)
- [Architecture overview](#architecture-overview) ·
  [Offline sync](#offline-sync-and-conflict-resolution)
- [How the API is built](#how-the-api-is-built-openapi-first)
- [Configuration](#configuration) · [Environment variables](#environment-variables)
- [Database](#database) · [Scripts](#scripts) · [Testing](#testing) · [CI](#ci)
- [Deployment](#deployment) · [Troubleshooting](#troubleshooting) ·
  [Contributing](#contributing)

## Features

**Members**

- Pick a block from the running session and record units: unit number, interest level,
  and optionally name, contact, religion and notes. The unit's earlier visits and
  outstanding follow-ups show as soon as its number is typed.
- Join the session and pair up in a team; teammates see and amend each other's records.
- Amend their own (and their team's) records while the session runs.
- Review their own history, or their team's, with the blocks and sessions they worked.
- Suggest a household for a return visit; an admin adds it to the follow-up list or
  declines it, and the member is told which, and why.
- In a follow-up session, work through the households on its list and mark each
  follow-up done. Members record only at those households in such a session.

**Admins**

- Create a door-to-door session and attach blocks, adding more while it runs; or a
  follow-up session from households picked off the follow-up list (at least one), whose
  blocks follow them. Start it, end it, and reopen one ended by mistake.
- Decide the follow-up list: review members' suggestions, add households that showed
  interest, take them off again (soft, always with a reason the author sees).
- View and amend every record, current and historical; see a unit's consolidated history.
- Manage members (add, change role, deactivate, restore) and session teams.

**In the field**

- Installable on a phone. Visits are saved on the phone first and sent when there is
  signal; a cold start with no signal opens an offline recording screen.

**Not built yet:** Google sign-in (#14). Sign-in is email and password only.

## Known limits

**Pairs cannot share records that have not synced.** Door-to-door is done in pairs, and
teammates can view and edit each other's records. But two phones with no reception cannot
talk to each other, so a record still waiting to sync exists on one phone only. Its
teammate sees and edits it after it has synced. The app says so on screen; changing this
means peer-to-peer sync between phones, a different and much larger piece of work.

**Amending, follow-ups and team changes are online-only.** Only new visits are queued
offline (D-33-13).

## Getting started

### Requirements

- Node.js 20+ (CI and the Docker image use 24) and npm 10+
- PostgreSQL 17, either through Docker Desktop (`docker compose`) or installed natively
- `psql`, to create databases when not using Docker (it ships with PostgreSQL)

### Quick start with Docker

```bash
git clone https://github.com/alphonsekoh/door-to-door.git
cd door-to-door
docker compose up
```

Open http://localhost:3000. Compose starts PostgreSQL, waits for it to be healthy,
applies migrations, seeds demo data, then starts the dev server. Editing a source file
hot-reloads in the container.

| Service   | Port | What it is                                     |
| --------- | ---- | ---------------------------------------------- |
| `web`     | 3000 | Next.js dev server                             |
| `db`      | 5432 | PostgreSQL, persisted in a named volume        |
| `db-test` | 5433 | Scratch database for integration and E2E tests |
| `migrate` | -    | Runs migrations and the seed once, then exits  |

`web` waits for `migrate` to complete successfully, so the app never starts against an
unmigrated database. Compose mounts [`config.docker.yaml`](config.docker.yaml) and passes
throwaway local credentials, including a public, development-only `AUTH_SECRET`. Point it
at another settings file with `CONFIG_FILE=./config.yaml docker compose up`.

```bash
docker compose down -v         # tear down, including data
docker compose up              # back to a freshly seeded install
docker compose up -d db-test   # only the scratch database, for tests
```

### Quick start without Docker

With a PostgreSQL of your own (here on `localhost:5432`, user and password `postgres`):

```bash
git clone https://github.com/alphonsekoh/door-to-door.git
cd door-to-door
npm install

psql postgresql://postgres:postgres@localhost:5432/postgres -c "create database door_to_door"
cp config.example.yaml config.yaml    # database.url already points at that database

export DATABASE_USER=postgres DATABASE_PASSWORD=postgres
export AUTH_SECRET="$(openssl rand -base64 32)"

npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000. If your database is elsewhere, edit `database.url` in
`config.yaml`, with no username or password in it: those stay in the environment. The
variables must be exported in every shell that runs the app or a `db:*` script (a `.env`
file covers only some commands; see [Environment variables](#environment-variables)).
[`.env.example`](.env.example) lists them all and shows one way to keep them in a file.

The session cookie is always `Secure`. Chrome and Firefox keep it on `localhost` over
plain http; Safari, or a phone opening the app on your LAN over http, can drop it, and
sign-in then lands back on the sign-in page. For such a run, set
`auth.secureCookies: false` in `config.yaml`.

### Record your first visit

The seed has two ended sessions and one draft, `Bedok · upcoming session`, with `Blk 456`
attached. Members can record only while a session is running, so an admin starts it
first.

1. Sign in as `admin@example.com` / `password123`.
2. Tap **Admin** in the bottom nav, open `Bedok · upcoming session`, tap **Start session**.
   (Optionally tap **Add blocks** first: `Blk 123` has seeded history to look at.)
3. **Account** → **Sign out**, then sign in as `alice@example.com` / `password123`.
4. The **Session** tab lists the running session's blocks. Tap `Blk 456`.
5. Type a unit number, e.g. `#04-12`, tap an interest level, then **Save and next**.
6. The **All units** tab shows the unit with your record, marked "this session". **History**
   shows the session.

The admin follows progress on the session screen and taps **End session** when done.

## Architecture overview

One Next.js 16 app (App Router, React 19) serves both the screens and the JSON API.
PostgreSQL, through Drizzle ORM, is the only server-side store; on the phone, IndexedDB
holds the queue of unsent visits and a small local copy for offline launches. A Serwist
service worker makes the app installable and gives navigations an offline fallback.

```
phone                                   server (one Next.js process)
-----                                   ----------------------------
React screens ── src/lib (pure logic)   src/proxy.ts       optimistic redirect only
   │ save                               src/app/api/**     handlers, each in withContract()
   ▼                                    src/server/**      services, auth guards, sync
IndexedDB queue ── POST /visits/sync ─► src/db             Drizzle schema ─► PostgreSQL
   (src/lib/sync)                       src/generated      types + Zod from openapi.yaml
```

- **Households and visits.** A household is one `(block, unit_number)`; its name, contact
  and religion are the latest known and only ever updated with non-null values. A visit
  is one knock; its interest level and notes are never overwritten by a later visit, so
  the trajectory over time stays visible. Follow-ups attach to the household. A
  follow-up is on the list (`listed`, an admin's call) or `suggested` by a member, and
  removing one is a soft delete with a reason.
- **Sessions** (`outing_sessions` in the schema, `/sessions` in the API) go
  `draft → active → ended` and can be reopened. At most one is active app-wide, enforced
  by the database. A session is door-to-door or follow-up, fixed when it is created. A
  follow-up session goes back to households an admin picked from the follow-up list,
  and its blocks follow them; members record only at households on its list.
- **Auth** is Auth.js v5 with email and password (argon2id), on JWT sessions. Every
  handler re-reads the user's role and deactivation from the database; the token's role
  is a UI hint only.
- **Settings** are a YAML file read at runtime; secrets come from the environment.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the full picture: layers, the request
path, the client, the service worker and the offline model. The decision behind each
piece, with its reason, is in [`docs/tasks/`](docs/tasks/README.md) under a stable
`D-<issue>-<n>` ID; the contested ones are summarised in
[ARCHITECTURE.md, "Contested decisions"](docs/ARCHITECTURE.md#contested-decisions).

## Offline sync and conflict resolution

The least obvious part of the system. In short (details in
[ARCHITECTURE.md, "Offline"](docs/ARCHITECTURE.md#offline)):

1. **Save to the phone first.** The recording form writes the visit to IndexedDB and
   moves on; it posts directly only when the queue cannot be written (D-33-10). Each
   visit gets a **client-generated UUIDv7** id, and the database has no default for it
   (D-07-3).
2. **Send in batches.** A controller sends the signed-in member's queued visits to
   `POST /visits/sync`, up to 100 per request, on app start, each save, regaining signal,
   focus and Retry. It first checks that the member who saved them is still the one
   signed in; another member's records stay on the phone untouched (D-33-1).
3. **The server answers per item**, in request order (D-21-3):

   Each item's `status` is `applied`, `unchanged`, `stale` or `rejected`; a rejected item
   also carries an `error` whose `code` says why.

   | Status, or code when `rejected`     | Meaning                                               | The phone                             |
   | ----------------------------------- | ----------------------------------------------------- | ------------------------------------- |
   | `applied`                           | Created, or a newer edit was written                  | Marks it sent                         |
   | `unchanged`                         | Already stored: a replay of the same id (D-21-1)      | Marks it sent                         |
   | `stale`                             | The server's copy has a newer `updatedAt` (D-21-2)    | Marks it sent; the server's wins      |
   | `rejected`: `session_not_active`    | Its session has ended (D-21-4)                        | Holds it; a reopen lets it in         |
   | `rejected`: `not_on_follow_up_list` | A new visit off a follow-up session's list (D-117-15) | Holds it; picking the unit lets it in |
   | `rejected`: `clock_skew`            | Stamped in the future or before its session (D-76-4)  | Restamps and resends (D-33-3)         |
   | `rejected`: `conflict`, `not_found` | Not this member's to change, or would move a visit    | Holds it for a tap (D-33-16)          |
   | `rejected`: `internal_error`        | Something failed on the server                        | Retries with backoff (D-33-4)         |

4. **Conflicts resolve last-write-wins on `updatedAt`**, within what a sync may change.
   Replaying is harmless because the id is the idempotency key. An update can change only
   the interest level, notes and `updatedAt`, plus non-null household identity; never the
   author, session, team or unit (D-74-22, D-74-31, D-74-32). Only the author or a current
   teammate may amend through sync. A wrong phone clock cannot win: a batch whose
   `sentAt` is more than `sync.clockSkewToleranceSeconds` from server time is refused
   whole (D-76-3), and items stamped in the future or before their session started are
   rejected while the rest apply (D-76-4).
5. **Nothing unsent is ever deleted** (D-33-2). Failures back off from 5 s to 5 min; a
   record that fails on its own 10 times is quarantined but kept, and Retry is the only
   action (D-33-26, D-33-27). Sent records are purged after 24 hours (D-33-9).

## How the API is built (OpenAPI-first)

[`openapi.yaml`](openapi.yaml) is the source of truth (D-10-1). TypeScript types and Zod
validators are generated from it into `src/generated/` by `@hey-api/openapi-ts`, and every
route handler validates its request **and its response** against them through
`withContract()` (D-12-1). Only types and validators are generated: the SDK and client
plugins are off because their runtime does not satisfy `exactOptionalPropertyTypes`, so
screens call the API with `fetch` through `src/lib/api-client.ts`.

To add or change an endpoint:

1. **Edit the spec.** Change `openapi.yaml`, then run `npm run spec:lint` until it passes.
2. **Regenerate.** `npm run generate:api` rewrites `src/generated/`. Commit the result;
   never edit it by hand.
3. **Implement.** The handler lives at the path the spec implies:
   `/sessions/{id}/start` → `src/app/api/sessions/[id]/start/route.ts`. Export the method
   wrapped in `withContract({ operationId, path, query, body, responses }, handler)` with
   the generated `z*` schemas. The handler re-checks authorization itself (`currentUser()`,
   `currentUser("admin")`) and calls a service in `src/server/<domain>/`.
4. **Test.** Integration tests call the handler against a real database. A spec
   operation with no route file fails `src/server/http/route-registry.test.ts`; a
   response that drifts from the spec throws in tests and is a logged `500` in production.

CI regenerates on every push and fails if `src/generated/` differs, so a spec change
without regenerating and a hand edit are both caught. A test also asserts that the spec's
enums match the database `pgEnum` values.

To browse the documented API, `npm run spec:preview` renders it to one HTML file,
`.next/api-docs.html`; open it in a browser.

## Configuration

App settings live in a YAML file, read when the server starts and never bundled into the
build: change a value, restart, no rebuild (D-75-1). Copy
[`config.example.yaml`](config.example.yaml) to `config.yaml` (git-ignored); every key is
documented there. Unknown keys are errors, so a typo cannot silently fall back to a
default (D-75-4).

| Key                              | Default | Meaning                                                        |
| -------------------------------- | ------- | -------------------------------------------------------------- |
| `database.url`                   | -       | **Required.** Connection URL **without** username or password  |
| `auth.trustHost`                 | `true`  | Trust the `Host` header from a reverse proxy                   |
| `auth.secureCookies`             | `true`  | Cookies `Secure` whatever the scheme; `false` for plain http   |
| `auth.google.clientId`           | unset   | Google client ID, reserved for Google sign-in (#14, not built) |
| `rateLimit.signInAttempts`       | `10`    | Failed sign-in attempts per email within the window            |
| `rateLimit.signInWindowSeconds`  | `300`   | Length of that window                                          |
| `sync.clockSkewToleranceSeconds` | `300`   | Tolerated difference between a phone's clock and the server's  |

Numbers must be whole and at least 1. `database.url` may carry only the `sslmode` and
`application_name` query parameters; credentials in it are refused (D-75-3).

## Environment variables

Secrets and process plumbing only; every setting is in the file. **Export them** in the
shell that runs the command. A `.env` file reaches some commands and not others, so do not
rely on one:

| Command                                       | Reads `.env`?                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`, `npm run build`                | Yes: Next loads it. The copy Next puts in `.next/standalone/` is deleted |
| `npm run start:standalone`                    | **No.** The standalone output holds no `.env` and no `config.yaml`       |
| `npm run db:generate`, `db:push`, `db:studio` | Yes: drizzle-kit loads it                                                |
| `npm run db:migrate`, `db:seed`, `db:reset`   | **No.** These run under `tsx`; the variables must be exported            |
| `npm run create-admin`, `db:check-blank`      | **No.** As above                                                         |

Because Next still loads a `.env`, a stale one can look as though it configures the app.
The server therefore warns once at startup when it finds one (D-75-16): settings belong in
`config.yaml`. [`.env.example`](.env.example) is a checklist of every variable to export,
with placeholders.

Each secret also has a `_FILE` variant naming a file to read it from (a trailing newline
is dropped), which is how Docker and Kubernetes secrets arrive. Set one or the other;
both is a startup error (D-75-2).

**Secrets** (never commit them, never put them in `config.yaml`)

| Variable                             | Required                                | Read by             | Meaning                                                                                             |
| ------------------------------------ | --------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_USER`, `DATABASE_PASSWORD` | yes                                     | app, `db:*` scripts | Added to `database.url`, percent-encoded for you                                                    |
| `AUTH_SECRET`                        | yes                                     | app                 | Signs session cookies. 32+ random characters, not a placeholder (D-75-6): `openssl rand -base64 32` |
| `AUTH_GOOGLE_SECRET`                 | only once `auth.google.clientId` is set | app                 | Google client secret, reserved for #14                                                              |

**Not secret, all optional** (the test URLs carry credentials, but only for throwaway local databases)

| Variable                                   | Default                                                          | Meaning                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                              | `./config.yaml`; `/app/config.yaml` in the image                 | Where the settings file is                                                                                                                                  |
| `AUTH_URL`                                 | unset                                                            | Public URL, read by Auth.js itself; only needed with `auth.trustHost: false`                                                                                |
| `PORT`, `HOSTNAME`                         | `3000`; `0.0.0.0` in the image                                   | Where the standalone server listens                                                                                                                         |
| `NODE_ENV`                                 | set by Next; `production` in the image                           | Production enables the service worker and turns contract drift into a logged `500` instead of a throw                                                       |
| `NEXT_TELEMETRY_DISABLED`                  | `1` in the image                                                 | Opts out of Next.js telemetry                                                                                                                               |
| `CONFIG_FILE`                              | `./config.docker.yaml`                                           | Compose only: which settings file to mount                                                                                                                  |
| `WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING` | `true` in Compose                                                | Compose only: watch files by polling, for bind mounts on macOS and Windows                                                                                  |
| `TEST_DATABASE_URL`                        | -                                                                | Tests only, and required by `test:integration`, `test:all`, `test:coverage`. A full URL with credentials; tables are truncated, so never real data (D-75-8) |
| `E2E_DATABASE_URL`                         | `postgresql://postgres:postgres@localhost:5433/door_to_door_e2e` | E2E only: created and reseeded on every run                                                                                                                 |
| `E2E_PORT`                                 | `3210`                                                           | E2E only: the port the suite serves the build on                                                                                                            |
| `FC_SEED`, `FC_RUNS`                       | `34`, `150`                                                      | Offline sync fuzz test: replay or extend it                                                                                                                 |
| `CI`                                       | unset                                                            | Playwright: forbids `test.only`, never reuses a running server, GitHub reporter                                                                             |

## Database

Migrations live in `drizzle/` and are **always generated**, never hand-written:

```bash
# edit src/db/schema.ts, then:
npm run db:generate -- --name describe_the_change
npm run db:migrate
```

Never edit a migration that has been applied; add a new one. Drizzle records what it has
run, so `db:migrate` is safe to re-run.

### Seeded logins

Development only. The seed is deterministic and idempotent: re-running it changes nothing.

| Email               | Role   | Password      |
| ------------------- | ------ | ------------- |
| `admin@example.com` | admin  | `password123` |
| `alice@example.com` | member | `password123` |
| `ben@example.com`   | member | `password123` |
| `cara@example.com`  | member | `password123` |

It creates four blocks, two ended sessions with visits across them, a draft session ready
to start, and follow-up notes both outstanding and resolved. Several units are visited
twice so the history screens have a trajectory to show: `Blk 123 #05-123` goes from `low`
to `medium` between March and June.

## Scripts

| Script                     | What it does                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`              | Dev server on port 3000 (`npm run dev -- -p 4000` for another)               |
| `npm run build`            | Standalone build free of `.env`/`config.yaml`; needs no config or database   |
| `npm run start:standalone` | Serve the production build as Docker does; reads `./config.yaml` by default  |
| `npm start`                | Alias for `npm run start:standalone`                                         |
| `npm run lint`             | `next typegen`, then type-aware ESLint                                       |
| `npm run lint:fix`         | The same, with autofix                                                       |
| `npm run typecheck`        | `next typegen`, then `tsc --noEmit`                                          |
| `npm run format`           | Prettier, writing                                                            |
| `npm run format:check`     | Prettier, check only                                                         |
| `npm test`                 | Unit and component tests; no database needed                                 |
| `npm run test:watch`       | Vitest watch mode                                                            |
| `npm run test:unit`        | Unit project only                                                            |
| `npm run test:components`  | Component project only                                                       |
| `npm run test:integration` | Integration project (**needs `TEST_DATABASE_URL`**)                          |
| `npm run test:all`         | Every project (**needs `TEST_DATABASE_URL`**)                                |
| `npm run test:coverage`    | Every project, then the coverage thresholds (**needs `TEST_DATABASE_URL`**)  |
| `npm run test:e2e`         | Playwright at phone size against a production build (needs Postgres on 5433) |
| `npm run test:e2e:ui`      | The same in Playwright's UI mode                                             |
| `npm run db:generate`      | Generate a migration from schema changes (no running database needed)        |
| `npm run db:migrate`       | Apply pending migrations                                                     |
| `npm run db:seed`          | Seed deterministic demo data                                                 |
| `npm run db:reset`         | Migrate, then seed. Does not delete anything                                 |
| `npm run create-admin`     | Create the first admin of an empty database (see [Deployment](#deployment))  |
| `npm run db:check-blank`   | List blank units, notes, block names and streets; changes nothing (exit 1)   |
| `npm run db:push`          | Push the schema straight to the database, skipping migrations (dev only)     |
| `npm run db:studio`        | Open Drizzle Studio                                                          |
| `npm run spec:lint`        | Lint `openapi.yaml`                                                          |
| `npm run spec:preview`     | Render the API docs to `.next/api-docs.html`                                 |
| `npm run generate:api`     | Regenerate types and Zod schemas from `openapi.yaml`                         |
| `npm run icons`            | Regenerate the PWA icons from `public/icon.svg`                              |

The `npm run build` check of the standalone output runs as an npm `postbuild` hook, so
running `next build` directly skips it: always build with `npm run build`.

The `db:*` scripts read `config.yaml` and need `DATABASE_USER` and `DATABASE_PASSWORD`
exported (the drizzle-kit ones, `db:generate`, `db:push` and `db:studio`, also take them
from a `.env`). `db:generate` is the partial exception: it never connects, so with no
config file it runs without them, but once a `config.yaml` exists (as the quick start
creates) it still loads it and fails without them. Any value will do for `generate`.

## Testing

```bash
npm test                   # unit + components, no database
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/door_to_door_test
npm run test:integration   # against a real PostgreSQL
npm run test:coverage      # everything, with thresholds enforced
```

`docker compose up -d db-test` provides that database. With a native PostgreSQL, create it
first; the suite migrates it but does not create it:

```bash
psql postgresql://postgres:postgres@localhost:5433/postgres -c "create database door_to_door_test"
```

If your server listens on another port (say 5432), change it in both places: the `psql`
command and `TEST_DATABASE_URL`. For E2E, set `E2E_DATABASE_URL` to the same server.

Vitest runs three projects, picked by file suffix: `*.test.ts` is `unit` (node),
`*.integration.test.ts` is `integration` (node, real PostgreSQL, one file at a time) and
`*.test.tsx` is `components` (jsdom and Testing Library). Integration tests fail loudly
when `TEST_DATABASE_URL` is unset rather than skipping: a suite that quietly runs nothing
is worse than one that does not run.
Each run writes its test `config.yaml` to a private folder under the system temp directory
and removes it afterwards, so two runs at once (two worktrees, or two terminals) do not
share a config. Give them different `TEST_DATABASE_URL`s, since each run truncates its
database.

Coverage is enforced per glob: **100%** for `src/server/**`, `src/lib/**`,
`src/app/api/**`, `src/db/**`, `src/auth/**` and root-level `src/*.ts`; **90%** for
`src/components/**` and `src/app/**`. Generated code, migrations, the integration-test
harness (`src/db/testing.ts`) and route `layout.tsx` files are excluded.

The offline sync fuzz (`src/lib/sync/fuzz.test.ts`) runs a fixed seed. To explore further
or replay a failure: `FC_SEED=7 FC_RUNS=400 npx vitest run src/lib/sync/fuzz.test.ts`. The test has a fixed
30-second timeout, so keep `FC_RUNS` to a few hundred (400 runs take about 9 seconds).

### End-to-end

```bash
docker compose up -d db-test               # or any PostgreSQL on localhost:5433, postgres/postgres
npx playwright install chromium webkit     # once
npm run test:e2e
```

Playwright builds the app, serves the standalone output and drives it on two phone
profiles, **Pixel 5 (Chromium)** and **iPhone 13 (WebKit)**. It creates and reseeds its
own `door_to_door_e2e` database, so it never disturbs the integration suite. The specs in
`e2e/` cover signing in and the role split, recording a visit (with and without signal),
a session's lifecycle, a follow-up session, teams, the account screen and sign-out, and
the PWA (the worker, offline fallback, caching and phone layout). Three offline-navigation
tests are skipped on WebKit because Playwright's WebKit offline emulation bypasses the
service worker (D-32-18). The browser runs at UTC+14 and the server at UTC−12, so their
dates always differ, and a spec fails on any hydration mismatch on a page it loads,
attributes included (D-117-64). It fails on any Content Security Policy violation too:
the policy only reports for now (#146), so nothing else would notice one.

The suite is deliberately thin; Vitest owns coverage. It exists for what jsdom cannot
see: layout, stacking order, client-side navigation and the production build.

## CI

Every push to `main` and every pull request runs four jobs
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job        | Checks                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| **Static** | lint · typecheck · format · spec lint · generated API code matches the spec · migrations match the schema |
| **Tests**  | unit, component and integration tests against PostgreSQL 17, then the coverage gate                       |
| **E2E**    | the Playwright suite on Chromium and WebKit                                                               |
| **Build**  | production `next build`, with no config file and no database                                              |

## Deployment

The app ships as a Docker image: the `runner` stage of the [`Dockerfile`](Dockerfile),
Next.js standalone output on `node:24-alpine`, running as uid 1001 on port 3000. No
hosting target has been chosen; anything that runs a container next to PostgreSQL will do.

```bash
docker build -t door-to-door .
docker run -p 3000:3000 \
  -v ./config.yaml:/app/config.yaml:ro \
  -e DATABASE_USER -e DATABASE_PASSWORD -e AUTH_SECRET \
  door-to-door
```

- **Settings** are not in the image: mount `config.yaml` read-only at `/app/config.yaml`
  (or set `CONFIG_PATH`). It must be readable by uid 1001 (`chmod 644`). Change a value by
  editing the file and restarting.
- **Secrets** come from the environment or their `_FILE` variants. Generate a fresh
  `AUTH_SECRET`; never reuse the Compose development one.
- **Startup is validated.** A bad file, a missing secret or a placeholder `AUTH_SECRET`
  stops the server with `Cannot start: ...`, naming the file and key, never the value.
- **Migrations** must be applied before a new version starts. The runner image holds the
  `drizzle/` folder but not the migration runner, so run `npm run db:migrate` from a
  checkout, or from a `dev`-stage container as the Compose `migrate` service does, with
  the production `config.yaml` and credentials. Never run `db:seed` in production: it
  creates the demo logins.
- **Before migration `0005_not_blank_text`**, run `npm run db:check-blank` the same way.
  Until #119 a unit number, follow-up note, block name or street of nothing but spaces
  was stored as an empty string, and the migration's `CHECK` constraints refuse those
  rows. The script lists each one with its ids, block, unit, author and created time,
  changes nothing, and exits `0` when there are none, `1` when there are, and `2` when it
  could not check. Correct what it lists by hand, as you decide, then migrate. Deleting a
  household also deletes everything recorded at it, its visits and follow-up notes
  included, so give it its real unit number instead; if that unit already exists in the
  block (`households_block_unit_unique` allows only one), move the visits and notes there
  first. A blank note can be corrected or deleted on its own; one removed in the app still
  counts until it is. A block cannot be deleted while households or sessions use it.
- **HTTPS** is required for the service worker and installing outside `localhost`. Behind
  a reverse proxy keep `auth.trustHost: true`, and have it send `X-Forwarded-Proto: https`;
  if the app is exposed directly with `trustHost: false`, set `AUTH_URL`. The session
  cookie is `Secure` (`__Secure-authjs.session-token`) whatever scheme the proxy forwards,
  as long as `auth.secureCookies` stays `true`, its default; keep it so in any deployment.
- **The app sends its own security headers.** Every response carries a Content Security
  Policy (Report-Only for now, #146), HSTS (`max-age=63072000`, no `includeSubDomains`),
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `X-Frame-Options: DENY`; API responses are `Cache-Control: no-store`. A proxy should not
  add a second CSP, since browsers enforce both and allow only what both allow, and an
  HSTS it adds should match this one.
- **The proxy must pass the public host:** forward the original `Host`, or set
  `X-Forwarded-Host` to it. A write from a browser that sends no `Sec-Fetch-Site` (Safari
  before 16.4, so iPhones on iOS 15 and 16.0 to 16.3) is checked by comparing its `Origin`
  with that host, and refused with `403` if the server sees only the proxy's. Those
  members still sign in, but nothing they record ever sends. Caddy and Traefik pass it by
  default; nginx needs `proxy_set_header Host $host;` (or `X-Forwarded-Host $host`).
- **Database connections:** one `pg` pool per process; changing `database.url` needs a
  restart. A dropped connection fails that request with a `500` and is replaced.
- **Accounts:** there is no sign-up. Admins add members on **Admin → Team**. A fresh
  database has no admin, so after migrating, create the first one from the same place you
  ran `db:migrate`, with the same `config.yaml` and credentials:

  ```bash
  npm run create-admin -- --email lead@example.org --name "Lead Organiser"
  ```

  It prompts twice for the password without echoing it. Without a terminal, point
  `ADMIN_PASSWORD_FILE` at a file holding it, or read it into the environment unechoed
  with `read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD`. Setting `ADMIN_PASSWORD`
  directly is meant for orchestrators and secret managers, not for typing at a prompt.
  There is no `--password` flag, so through the prompt or the file the password never
  lands in shell history or `ps`. The email and password follow the rules of
  **Admin → Team** (a valid address, 8 to 200 characters).
  The script refuses, changing nothing, if any admin already exists, deactivated ones
  included: later admins are added in the app.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot start: Configuration file not found at .../config.yaml` | Copy `config.example.yaml` to `config.yaml`, or point `CONFIG_PATH` at your file.                                               |
| `Cannot start: AUTH_SECRET is not set` (or `DATABASE_USER`...)  | Export the variable in the shell that starts the server or script. `db:migrate`, `db:seed` and `db:reset` never read `.env`.    |
| `AUTH_SECRET must be a random value of at least 32 characters`  | It is short or looks like a placeholder (`changeme`, `example`...). Use `openssl rand -base64 32`.                              |
| `Set either X or X_FILE, not both.`                             | Unset one of them.                                                                                                              |
| `database.url: must not contain a username or password`         | Take the credentials out of the URL and export `DATABASE_USER` and `DATABASE_PASSWORD`.                                         |
| `Found a .env file ... It is not used for app settings`         | Next loaded a `.env` from the directory the server runs in. Move settings to `config.yaml`, export secrets, delete it.          |
| `TEST_DATABASE_URL is not set` from the integration project     | Export it, e.g. `postgresql://postgres:postgres@localhost:5433/door_to_door_test`, with `docker compose up -d db-test` running. |
| The E2E suite cannot reach its database                         | It needs PostgreSQL on `localhost:5433` (`docker compose up -d db-test`), or set `E2E_DATABASE_URL`.                            |
| `check constraint "..._not_blank" ... is violated by some row`  | `db:migrate` met a blank unit, note, block name or street stored before #119. Run `npm run db:check-blank` to list them.        |
| Members see "No session is running"                             | An admin starts one: **Admin**, open the session, **Start session**. Only one runs at a time.                                   |
| "This unit is not on this session's list"                       | Members record only the session's picks. An admin lists it, then **Add households** on the session's page, or records it.       |
| Sign-in lands back on sign-in over plain http                   | Safari on `localhost`, or a phone on the LAN, dropped the `Secure` cookie. Set `auth.secureCookies: false` for that run.        |
| Older iPhones stay on "The server is busy" and never send       | The proxy hides the public host, so their writes get `403`. Pass `Host` or set `X-Forwarded-Host` (see Deployment).             |
| A new deploy does not show up on a phone                        | Updates are prompted, never forced. The banner waits while the member still has records being sent; tap it once it appears.     |
| The service worker never registers in development               | By design: it is enabled only in production builds. Use `npm run build && npm run start:standalone`.                            |
| The dev server does not hot-reload in Docker                    | Compose sets `WATCHPACK_POLLING`; if you run `next dev` in another container, set it too.                                       |

## Project structure

```
src/
  app/          routes; app/api/** holds route handlers, one file per contract path
  components/   React components, one folder per domain: ui (shared pieces), shell, pwa,
                sync, visits, households, history, follow-ups, sessions, blocks, teams,
                admin, account
  lib/          framework-free helpers, one folder per domain: pwa, teams, units,
                history, follow-ups, hooks, session, sync (offline queue), offline
                (local copy)
  auth/         the Auth.js entrypoint, imported as @/auth; Google sign-in (#14) goes here
  server/       server-only services, auth guards, withContract
  db/           Drizzle schema, client and seed data
  generated/    generated from openapi.yaml - never edit by hand
  proxy.ts      optimistic sign-in redirect (Next 16's name for middleware)
drizzle/        generated migrations - never edit by hand
e2e/            Playwright specs
test/           Vitest setup files
scripts/        migrate, seed, create-admin, check-blank-text, generate-icons,
                check-standalone (postbuild)
docs/           architecture, research and per-issue decisions
```

## Contributing

Read [CLAUDE.md](CLAUDE.md): it holds the domain model and the working rules, each marked
as CI-enforced or convention. Check [`docs/tasks/`](docs/tasks/README.md) for prior
decisions before making one.

Branches are stacked: a feature branch bases off the previous one and its PR targets that
branch rather than `main`. Merge top-down, and squash or rebase rather than creating a
merge commit.
