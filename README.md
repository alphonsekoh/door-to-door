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
- [Deployment](#deployment) · [Stage environment](#stage-environment) ·
  [Troubleshooting](#troubleshooting) · [Branches](#branches) · [Contributing](#contributing)

## Features

**Members**

- Pick a block from the running session and record units: unit number, interest level,
  and optionally name, contact, religion and notes. The unit's latest 20 visits and
  outstanding follow-ups show as soon as its number is typed, and older visits are a tap
  away.
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
- Manage members (add, with or without a password, change role, deactivate, restore)
  and session teams. See where each member is signed in, and sign them out of one device
  or all of them.

**In the field**

- Installable on a phone. Visits are saved on the phone first and sent when there is
  signal; a cold start with no signal opens an offline recording screen.

**Signing in** is with Google, where a newcomer waits for an admin's approval, with
email and password as the fallback. Signing out ends that device's sign-in only.

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

- Node.js 24.15+ or 22.22.2+, which the test tools need (CI and the Docker image use 24),
  and npm 10+
- PostgreSQL 17, either through Docker Desktop (`docker compose`) or installed natively
- `psql`, to create databases when not using Docker (it ships with PostgreSQL)

### Quick start with Docker

```bash
git clone https://github.com/alphonsekoh/door-to-door.git
cd door-to-door
docker compose up
```

Open http://localhost:3000. Compose starts PostgreSQL, waits for it to be healthy,
applies migrations, then starts the dev server and seeds demo data. Editing a source
file hot-reloads in the container.

| Service   | Port | What it is                                                       |
| --------- | ---- | ---------------------------------------------------------------- |
| `web`     | 3000 | Next.js dev server                                               |
| `db`      | 5432 | PostgreSQL, persisted in a named volume                          |
| `db-test` | 5433 | Scratch database for integration and E2E tests                   |
| `migrate` | -    | Applies migrations once, then exits                              |
| `seed`    | -    | Seeds the demo data once `migrate` is done (`db:seed -- --demo`) |

Every port is published on `127.0.0.1` only, so nothing is reachable from your LAN: the
credentials are public. `web` waits for `migrate` to complete successfully, so the app
never starts against an unmigrated database; it never waits for `seed`. The seed refuses
a database that has users of its own (see [Seeded logins](#seeded-logins)), so once you
add someone in the app, `seed` exits with that refusal on the next `up` and the app runs
as before. Compose mounts [`config.docker.yaml`](config.docker.yaml) and passes throwaway
local credentials, including a public `AUTH_SECRET` that only `next dev` accepts. To
change a setting, copy `config.docker.yaml` to `config.demo.yaml` (git-ignored) and run
`CONFIG_FILE=./config.demo.yaml docker compose up`.

```bash
docker compose down -v         # tear down, including data
docker compose up              # back to a freshly seeded install
docker compose up -d db-test   # only the scratch database, for tests
```

**Local demo, not production.** `docker compose up` is for this machine. To apply
migrations to a production database, run only the `migrate` service, with the production
settings file and credentials, and never `up` (see [Deployment](#deployment)):

```bash
CONFIG_FILE=./config.yaml DATABASE_USER=... DATABASE_PASSWORD=... \
  docker compose run --rm --no-deps migrate
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
npm run db:seed -- --demo
npm run dev
```

Open http://localhost:3000. If your database is elsewhere, edit `database.url` in
`config.yaml`, with no username or password in it: those stay in the environment. The
variables must be exported in every shell that runs the app or a `db:*` script (a `.env`
file covers only some commands; see [Environment variables](#environment-variables)).
[`.env.example`](.env.example) lists them all and shows one way to keep them in a file.

`npm run dev` listens on `127.0.0.1` and answers only requests addressed to `localhost`,
`127.0.0.1` or `[::1]`; under any other host name, every page and API route answers
`403`. That keeps a page on another site, whose name it has pointed at your machine
(DNS rebinding), from signing in to the dev server as the seed admin. To try the app on
a phone over your LAN, use the production build instead. It is also the only one with
the service worker, though over plain http off `localhost` the phone registers none
(see [Deployment](#deployment)).

**Only on a network you trust.** While it runs, anyone on the same network can reach the
app and sign in with the [seeded logins](#seeded-logins), whose password is public. On any
other network, run it against a database without the seed users.

```bash
npm run build && HOSTNAME=0.0.0.0 npm start   # with auth.secureCookies: false, see below
```

The sign-in cookies are always `Secure`. Chrome and Firefox keep them on `localhost`
over plain http; Safari, or a phone opening the app on your LAN over http, drops them.
Sign-in then says "This page expired. Reload it and try again." however often you
reload: the CSRF cookie never came back, so Auth.js refused the attempt (`MissingCSRF` in
the server log). For such a run, set `auth.secureCookies: false` in `config.yaml`.

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
- **Auth** is Auth.js v5: Google, where a newcomer waits for an admin's approval, and
  email and password (argon2id) as the fallback, on JWT sessions. Each sign-in is a `sign_ins` row that
  every request checks, so a sign-out, an admin or a deactivation ends it. Every handler
  re-reads the user's role and deactivation from the database; the token's role is a UI
  hint only.
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
   action (D-33-26, D-33-27). Sent records are purged after 24 hours (D-33-9), and a
   member's leave the phone when that member signs out on it (D-129-6).

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

CI regenerates on every run and fails if `src/generated/` differs, so a spec change
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

| Key                                 | Default | Meaning                                                                               |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `database.url`                      | -       | **Required.** Connection URL **without** username or password                         |
| `database.migrationUrl`             | `url`   | Where `db:migrate` and drizzle-kit connect instead: the direct host behind a pooler   |
| `auth.trustHost`                    | `true`  | Trust the `Host` header from a reverse proxy                                          |
| `auth.secureCookies`                | `true`  | Cookies `Secure` whatever the scheme; `false` for plain http                          |
| `auth.google.clientId`              | unset   | Google OAuth client ID; set it to offer Google sign-in (see below)                    |
| `auth.google.domains`               | -       | **Required with `auth.google`.** The domains Google sign-in works for (see below)     |
| `auth.google.issuer`                | unset   | **Test only:** a stand-in OpenID provider in place of Google; never in production     |
| `rateLimit.signInAttempts`          | `10`    | Failed sign-in attempts per email within the window                                   |
| `rateLimit.signInAttemptsPerClient` | `30`    | Failed sign-in attempts per client address within the window                          |
| `rateLimit.signInAttemptsGlobal`    | unset   | Failed sign-in attempts app-wide: an incident switch, see below                       |
| `rateLimit.signInWindowSeconds`     | `300`   | Length of that window                                                                 |
| `rateLimit.trustedProxyHops`        | `0`     | Reverse proxies that append to `X-Forwarded-For`; `0` turns the per-client budget off |
| `sync.clockSkewToleranceSeconds`    | `300`   | Tolerated difference between a phone's clock and the server's                         |

Numbers must be whole and at least 1, except `rateLimit.trustedProxyHops`, which may be 0.
`database.url` and `database.migrationUrl` may carry only the `sslmode` and
`application_name` query parameters; credentials in either are refused (D-75-3), and both
get the same `DATABASE_USER` and `DATABASE_PASSWORD`. The app connects only to
`database.url`; only `db:migrate` and drizzle-kit (`db:push`, `db:studio`) connect to
`database.migrationUrl`.

**Google sign-in** needs an OAuth client of type "Web application" in the Google Cloud
console. Register `<public origin>/api/auth/callback/google` as its authorised redirect
URI (for local development, `http://localhost:3000/api/auth/callback/google`). Put the
client ID in `auth.google.clientId` and export the client secret as
`AUTH_GOOGLE_SECRET`. In the Docker image, also set `AUTH_URL` to the public origin
(`https://<your domain>`): without it Google is sent back to the server's own
`0.0.0.0:3000` and refuses the sign-in (D-14-27). Someone an admin has added (on
**Admin → Team**, or with `create-admin`) signs in as themselves, once Google has
verified the address. Anyone else Google vouches for asks to join with their first
sign-in: they wait on a page of their own until an admin approves them under **Waiting
for approval** on **Admin → Team**, and can use nothing else (#249). A deactivated
account is refused. Without `auth.google`, sign-in is email and password only, and every
account needs a password.
No real credentials are needed for the tests: E2E runs a stand-in provider (D-14-14).

List in `auth.google.domains` only `gmail.com` and domains on Google Workspace, lower
case, with no `@` (D-14-19, D-14-20). Google sign-in works only at those domains,
matched exactly: no subdomains, and `googlemail.com` is not `gmail.com`. Members
elsewhere sign in with email and password, so add them with one.

- Google vouches for an address only at `gmail.com`, or for a Workspace account. On any
  other listed domain a member must use their Workspace account; a personal Google
  account made on that address is refused, since that mailbox could have changed hands.
- Add a Gmail address exactly as Google has it, dots included. Spelled otherwise, the
  member's Google sign-in asks to join as a second account: reject that request and
  correct the address.
- If a listed domain is a Workspace **alias** of another (as `tjc.org` may be of
  `tjc.sg`), rather than a secondary domain, Google reports the member's address at the
  primary domain. Add those members at the primary domain.
- Removing `auth.google`, or a domain from the list, strands the Google-only accounts it
  covered, a Google-only first admin included. No password can be added in the app.

`rateLimit.signInAttemptsGlobal` is an **incident switch**, off unless set. Once that many
sign-ins have failed within the window, every new sign-in is refused, the correct password
and admins included. Anyone can spend it, so setting it lets anyone block every new
sign-in. Switch it on only during an attack and off afterwards; members already signed in
stay signed in.

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

| Variable                             | Required                                | Read by             | Meaning                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_USER`, `DATABASE_PASSWORD` | yes                                     | app, `db:*` scripts | Added to `database.url`, percent-encoded for you                                                                                                                               |
| `AUTH_SECRET`                        | yes                                     | app                 | Signs session cookies. 32+ random characters, not a placeholder (D-75-6): `openssl rand -base64 32`. One marked `not-for-production`, as Compose's is, only `next dev` accepts |
| `AUTH_GOOGLE_SECRET`                 | only once `auth.google.clientId` is set | app                 | Google OAuth client secret                                                                                                                                                     |

**Not secret, all optional** (the test URLs carry credentials, but only for throwaway local databases)

| Variable                                   | Default                                                          | Meaning                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                              | `./config.yaml`; `/app/config.yaml` in the image                 | Where the settings file is                                                                                                                                                       |
| `CONFIG_YAML`                              | unset                                                            | The settings themselves, as the same YAML, for a host with no file to read (Vercel). Set it or `CONFIG_PATH`, not both; an empty value counts as unset                           |
| `AUTH_URL`                                 | unset                                                            | Public URL, read by Auth.js itself. Needed with Google sign-in in the image (D-14-27), and with `auth.trustHost: false`                                                          |
| `PORT`, `HOSTNAME`                         | `3000`; `0.0.0.0` in the image                                   | Where the standalone server listens                                                                                                                                              |
| `NODE_ENV`                                 | set by Next; `production` in the image                           | Production enables the service worker and turns contract drift into a logged `500` instead of a throw. Only `development` accepts a `not-for-production` `AUTH_SECRET` (D-124-7) |
| `NEXT_TELEMETRY_DISABLED`                  | `1` in the image                                                 | Opts out of Next.js telemetry                                                                                                                                                    |
| `VERCEL_URL`, `VERCEL_REGION`              | set by Vercel on its functions                                   | Read by `@vercel/functions`: with both set, the database pool keeps its instance awake until idle connections close. Never set them anywhere else                                |
| `CONFIG_FILE`                              | `./config.docker.yaml`                                           | Compose only: which settings file to mount                                                                                                                                       |
| `STAGE_PORT`, `STAGE_TOXIPROXY_PORT`       | `3400`, `3401`                                                   | Stage stack only: where its edge and toxiproxy's API are published, for Compose and `stage:perf`                                                                                 |
| `STAGE_AUTH_SECRET`                        | made once per stack                                              | Stage stack only: its app's `AUTH_SECRET`, in place of the one it makes                                                                                                          |
| `WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING` | `true` in Compose                                                | Compose only: watch files by polling, for bind mounts on macOS and Windows                                                                                                       |
| `TEST_DATABASE_URL`                        | -                                                                | Tests only, and required by `test:integration`, `test:all`, `test:coverage`. A full URL with credentials; tables are truncated, so never real data (D-75-8)                      |
| `E2E_DATABASE_URL`                         | `postgresql://postgres:postgres@localhost:5433/door_to_door_e2e` | E2E only: created and reseeded on every run                                                                                                                                      |
| `E2E_PORT`                                 | `3210`                                                           | E2E only: the port the suite serves the build on                                                                                                                                 |
| `E2E_GOOGLE_PORT`                          | `E2E_PORT` + 1000                                                | E2E only: the port of the stand-in Google provider (`e2e/fake-google.ts`)                                                                                                        |
| `FC_SEED`, `FC_RUNS`                       | `34`, `150`                                                      | Offline sync fuzz test: replay or extend it                                                                                                                                      |
| `CI`                                       | unset                                                            | Playwright: forbids `test.only`, never reuses a running server, GitHub reporter                                                                                                  |

## Database

Migrations live in `drizzle/` and are **always generated**, never hand-written:

```bash
# edit src/db/schema.ts, then:
npm run db:generate -- --name describe_the_change
npm run db:migrate
```

Never edit a migration that has been applied; add a new one. Drizzle records what it has
run, so `db:migrate` is safe to re-run.

`db:generate` also appends each new migration's SHA-256 to `drizzle/checksums.sha256`
(its `postdb:generate` hook), and `npm test` fails if a listed migration changed or is
gone, or a `.sql` file has no line. Only ever append to that file. If you drop a
migration that was never merged, delete its line too. A `--custom` migration fails the
test: its empty file is recorded before the SQL is written.

### Seeded logins

Development only. The seed is deterministic and idempotent: re-running it changes nothing.
It runs only as `npm run db:seed -- --demo` (or `npm run db:reset -- --demo`); no script
passes the flag for you. It first prints the database it targets, as
`Demo seed target: host:port/database`, and then refuses, writing nothing, without
`--demo`, or when the database has any user other than the four below: a database where
someone has an account is not a demo database.

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

| Script                     | What it does                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`              | Dev server on loopback, for `localhost` only (`-- -p 4000` for another port)                  |
| `npm run build`            | Standalone build free of `.env`/`config.yaml`; needs no config or database                    |
| `npm run start:standalone` | Serve the production build as Docker does; reads `./config.yaml` by default, or `CONFIG_YAML` |
| `npm start`                | Alias for `npm run start:standalone`                                                          |
| `npm run lint`             | `next typegen`, then type-aware ESLint                                                        |
| `npm run lint:fix`         | The same, with autofix                                                                        |
| `npm run typecheck`        | `next typegen`, then `tsc --noEmit`                                                           |
| `npm run format`           | Prettier, writing                                                                             |
| `npm run format:check`     | Prettier, check only                                                                          |
| `npm test`                 | Unit and component tests; no database needed                                                  |
| `npm run test:watch`       | Vitest watch mode                                                                             |
| `npm run test:unit`        | Unit project only                                                                             |
| `npm run test:components`  | Component project only                                                                        |
| `npm run test:integration` | Integration project (**needs `TEST_DATABASE_URL`**)                                           |
| `npm run test:all`         | Every project (**needs `TEST_DATABASE_URL`**)                                                 |
| `npm run test:coverage`    | Every project, then the coverage thresholds (**needs `TEST_DATABASE_URL`**)                   |
| `npm run test:e2e`         | Playwright at phone size against a production build (needs Postgres on 5433)                  |
| `npm run test:e2e:ui`      | The same in Playwright's UI mode                                                              |
| `npm run test:e2e:linux`   | The same suite in a Linux container, as CI runs it (needs Docker)                             |
| `npm run db:generate`      | Generate a migration and record its checksum (no running database needed)                     |
| `npm run db:migrate`       | Apply pending migrations, at `database.migrationUrl` when it is set                           |
| `npm run db:seed`          | Seed demo data: `npm run db:seed -- --demo`; refused if there are real users                  |
| `npm run db:reset`         | Migrate, then seed: `npm run db:reset -- --demo`. Deletes nothing                             |
| `npm run create-admin`     | Create the first admin of an empty database (see [Deployment](#deployment))                   |
| `npm run db:check-blank`   | List blank units, notes, block names and streets; changes nothing (exit 1)                    |
| `npm run db:push`          | Push the schema straight to the database, skipping migrations (dev only)                      |
| `npm run db:studio`        | Open Drizzle Studio                                                                           |
| `npm run spec:lint`        | Lint `openapi.yaml`                                                                           |
| `npm run spec:preview`     | Render the API docs to `.next/api-docs.html`                                                  |
| `npm run generate:api`     | Regenerate types and Zod schemas from `openapi.yaml`                                          |
| `npm run icons`            | Regenerate the PWA icons from `public/icon.svg`                                               |
| `npm run stage:up`         | Build and start the [stage stack](#stage-environment) at https://localhost:3400               |
| `npm run stage:seed`       | Load a year of records into the stage stack's empty database; refused anywhere else           |
| `npm run stage:perf`       | Measure the stage stack; `-- --db-latency 220` adds a database round trip                     |
| `npm run stage:logs`       | The stage stack's logs (`-- app` for one service)                                             |
| `npm run stage:psql`       | `psql` in the stage stack's database, to `EXPLAIN` a slow query                               |
| `npm run stage:down`       | Stop the stage stack and delete its data                                                      |

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
`e2e/` cover signing in and the role split, Google sign-in against a local stand-in
(never the real Google), an admin ending a member's sign-ins, recording a visit (with and
without signal), a session's lifecycle, a follow-up session, teams, the account screen
and sign-out, the PWA (the worker, offline fallback, caching and phone layout), every
screen at the largest text, and the admin lists' address: an old `?q=` link, and Needs
a return visit's filters moving it with no page round trip, online and offline.
Four tests in `pwa.spec` are skipped on WebKit because Playwright's WebKit fails a
request before the service worker can answer it, offline or routed (D-32-18, D-166-5),
and two in `sign-ins.spec` because it cannot hold or stop the worker's requests (R-138).
The browser runs at UTC+14 and the server at UTC−12, so their dates always differ, and a
spec fails on any hydration mismatch on a page it loads, attributes included (D-117-64).
It fails on any Content Security Policy violation too: the policy only reports for now
(#146), so nothing else would notice one.

The suite is deliberately thin; Vitest owns coverage. It exists for what jsdom cannot
see: layout, stacking order, client-side navigation and the production build.

#### On Linux, as CI runs it

CI runs the suite on Ubuntu, where WebKit draws text in DejaVu Sans rather than the
macOS system font (R-182), so a layout can pass here and fail there. To see CI's result
before a push spends Actions minutes on it, run the suite in a Linux container (Docker
Desktop must be running):

```bash
npm run test:e2e:linux                          # the whole suite, on HEAD
npm run test:e2e:linux -- --ref <commit>        # on another commit
npm run test:e2e:linux -- -- e2e/large-text.spec.ts:376 --project=mobile-webkit --repeat-each=40
npm run test:e2e:linux -- --platform linux/amd64   # CI's architecture, emulated (slower)
```

It runs a commit, never uncommitted changes: `git archive` feeds the container, so a
pass covers exactly what a push sends. The image is the `Dockerfile`'s `e2e` stage
(Ubuntu 26.04, Node 24, and Playwright's browsers installed as CI installs them), built
once and then cached until `package.json`, `package-lock.json` or the stage changes
(Dependabot's monthly digest bumps included). Each rebuild leaves the last image, about
3 GB, untagged; `docker image prune` reclaims it. The database is CI's postgres image in a
throwaway container on a private network, so the run needs neither the host's Postgres
nor any free port. One run goes at a time per clone, and a second one waits. The run
stops if `sans-serif` is not DejaVu Sans. The report lands in `e2e-linux-results/`:
`npx playwright show-report e2e-linux-results/playwright-report` opens it.

**The pre-push gate.** [`.githooks/pre-push`](.githooks/pre-push) runs the whole suite
this way on the tip of each branch a push sends, as CI does, and refuses the push if it
fails. Enable it once per clone; worktrees share the setting:

```bash
git config core.hooksPath .githooks
```

The hook lives in the branch, so a worktree on a branch from before it has none, and its
pushes go through ungated.

It skips branch deletions, pushes that change only docs (`docs/`, a top-level `*.md` or
`.claude/`), and any tree that has passed a whole-suite run or differs from one only in
docs, so running `npm run test:e2e:linux` before a push makes the push itself immediate.
`SKIP_E2E_LINUX=1 git push` skips the gate once. CI runs the suite only into `stage` or
`main`, or with the `e2e` label (see [CI](#ci)), so a skipped gate elsewhere leaves the
push untested on Linux until then.

## CI

CI runs on pull requests, never on a merge: the promotion's pull request already tested
what reaches `main`, and Vercel deploys it. A merge into `dev` or `main` only warms the
caches ([below](#caches)). A ready pull request runs four jobs
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), whose names the `dev`, `stage`
and `main` rulesets require:

| Job                        | Checks                                                                                                    | Runs                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Lint, types and format** | lint · typecheck · format · spec lint · generated API code matches the spec · migrations match the schema | Always, and first: the others wait for it       |
| **Tests and coverage**     | unit, component and integration tests against PostgreSQL 17, then the coverage gate                       | Unless only docs changed                        |
| **End-to-end smoke**       | the Playwright suite on Chromium and WebKit                                                               | Into `stage` or `main`, or with the `e2e` label |
| **Production build**       | production `next build`, with no config file and no database                                              | Unless only docs changed                        |

- **A draft runs nothing.** Open a pull request as a draft, push review fixes to it, and
  mark it ready once: that runs CI, and each later push runs it again. A draft's run
  skips every job, and its lint job reports under a name no ruleset requires, so the merge
  waits for a ready run's **Lint, types and format**. Its other three skips carry their
  required names, though, and pass them. So mark a draft ready only once the run for its
  last push has appeared (`gh run list --commit <sha> --workflow CI` lists it). GitHub
  can start the push's run after the ready one, and it then cancels the ready run. If the
  ready run's lint job is still running, that check is left cancelled until you re-run
  either run (**Re-run all jobs**). If it has finished, the draft's skips pass tests, the
  build and E2E over the ready run's results, and the pull request can merge untested.
  Reopening a pull request while it is a draft does the same over its last ready run's
  checks, so once you mark it ready again, wait for the new run before merging.
- **A lint failure stops the run** in about two minutes, before the other jobs start.
- **Docs only:** a pull request that changes nothing but `docs/`, `.claude/` and
  top-level Markdown skips the tests and the build
  ([`scripts/ci-changes.sh`](scripts/ci-changes.sh) decides). `README.md` counts as code,
  because tests read it.
- **E2E** runs on every pull request into `stage` or `main`, the last check before users
  see a change. Into `dev` or a feature branch it runs only with the `e2e` label. A push
  from a clone has already passed it in the [pre-push gate](#on-linux-as-ci-runs-it), but
  a commit made on GitHub (a web edit, **Update branch**) has not, so label that pull
  request. Dependabot labels its version updates itself; a security update comes with no
  labels, so label it when you retarget it to `dev`. The lint job reads the labels and
  base as they are when it starts ([`scripts/ci-e2e.sh`](scripts/ci-e2e.sh) decides), so
  a label added while the pull request is a draft takes effect in the ready run. Added
  later, it runs E2E at once ([`e2e-catch-up.yml`](.github/workflows/e2e-catch-up.yml)),
  and later pushes run it too. A label added in the seconds before lint reads it runs E2E
  in both workflows, on the same commit; Dependabot's and `gh pr create --label`'s
  usually do.
- **Retargeting** a ready pull request to `stage` or `main` runs E2E at once, in the same
  workflow. Any other edit runs nothing, and the other jobs are not re-run against the new
  base: close and reopen the pull request for that.
- **A skipped job passes a required check,** and the newest check of each name is the one
  that counts. So no label or edit reports a required check skipped, and CI reports
  **End-to-end smoke** skipped only as its run begins: its E2E job waits for lint, so a
  placeholder job that never runs reports that skip, and the E2E job takes the name only
  when it runs. Only a draft's run reports skips over a ready run's checks (see drafts
  above). `e2e-catch-up.yml`'s job is likewise named **End-to-end smoke** only
  when it runs the suite: every other label, and every title or body edit, starts a
  catch-up run whose one job is skipped under another name. GitHub shows a skipped job's
  name expression as written, so a required check is skipped only under a fixed name.
- **Re-running** all of a CI run's jobs (**Re-run all jobs**, or `gh run rerun <id>`)
  always runs the lint job, even in a draft's run, and it reads the labels and base
  afresh: tests and the build still skip when only docs changed, and E2E runs if the pull
  request is labelled or into `stage` or `main` now. A re-run otherwise replays the event
  that started the run: a draft's run would skip again over the ready run's checks, and a
  run from before a label or a retarget would skip E2E. **Re-run failed jobs** keeps the
  lint job's decision unless lint is among them.
- Every job has a timeout. CI's newer run for a pull request cancels its older one;
  `e2e-catch-up.yml` has no concurrency group and cancels nothing.

The jobs' token can only read the repository and, in `ci.yml`, its pull requests.
`actions/checkout` and `actions/setup-node` receive it as their default `token` input and
keep it in their own process, and checkout leaves it nowhere on disk. Of the other steps,
only the lint job's first is given it, to read the pull request's labels and base, before
any of the pull request's code or `npm ci` runs.
Every action is pinned by commit and every image by digest, and Dependabot keeps them
current; `src/supply-chain.test.ts` fails on a new line that is not pinned. Dependabot
cannot see CI's postgres service image, so when it bumps the one in `docker-compose.yml`,
copy the digest into `ci.yml` and `e2e-catch-up.yml` (the test fails until you do). Its
`docker-compose` entry reads the [stage stack](#stage-environment)'s file too, and
`src/stage-stack.test.ts` fails if the stage postgres differs from the dev stack's.

Dependabot proposes version updates monthly and never rebases them on its own: each
rebase is a CI run, and it would rebase every open one whenever `dev` moves. Comment
`@dependabot rebase` on one to bring it up to date. `src/ci-runs.test.ts` holds the
workflows and `.github/dependabot.yml` to these rules.

### Caches

CI's jobs restore npm's cache and the build's `.next/cache`, and the E2E job restores
Playwright's browsers, keyed by the OS release, the architecture and the Playwright
version. A cache that a pull request's run saves is that pull request's alone, but a run
can also restore its base branch's and `main`'s. So each merge into `dev` or `main` runs
[`warm-caches.yml`](.github/workflows/warm-caches.yml), which saves the same keys in that
branch's scope: npm's after `npm ci`, the browsers when their key is new, and
`.next/cache` from a build when `src/` or the lockfile changed. A pull request into `dev`
restores `dev`'s. One into `stage`, `main` or a feature branch restores `main`'s, which
move only on a promotion, so a key that has changed on `dev` since (a new lockfile or
Playwright) misses until the next one. The warm-up runs on no pull request or draft,
reports no check a ruleset requires, has no secret and can only read. A later merge into
the same branch cancels one still running. `src/ci-runs.test.ts` holds its keys to CI's.

## Deployment

The app ships as a Docker image: the `runner` stage of the [`Dockerfile`](Dockerfile),
Next.js standalone output on `node:24-alpine` (pinned by digest), running as uid 1001 on
port 3000. Production does not use it: it is the same app on Vercel, with settings from
`CONFIG_YAML`, and PostgreSQL 17 on Neon. The image runs anywhere that runs a container
next to PostgreSQL.

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
- **Settings without a file** (a host such as Vercel, where a file would be part of the
  build): set `CONFIG_YAML` to the whole YAML text instead of mounting a file. It is read
  and checked exactly as the file is (no credentials in it, unknown keys refused) and is
  an error beside `CONFIG_PATH`. The build still holds no settings, and `db:migrate` and
  `create-admin` read it too. Changing it needs a new deployment.
- **Secrets** come from the environment or their `_FILE` variants. Generate a fresh
  `AUTH_SECRET`; the Compose development one is refused outside `next dev`.
- **Startup is validated.** A bad file, a missing secret, or a placeholder or development
  `AUTH_SECRET` stops the server with `Cannot start: ...`, naming the file and key, never
  the value.
- **Migrations** must be applied before a new version starts. The runner image holds the
  `drizzle/` folder but not the migration runner, so run `npm run db:migrate` from a
  checkout, or the Compose `migrate` service on its own, with the production
  `config.yaml` and credentials. It connects to `database.migrationUrl` when that is set,
  and to `database.url` otherwise:

  ```bash
  CONFIG_FILE=./config.yaml DATABASE_USER=... DATABASE_PASSWORD=... \
    docker compose run --rm --no-deps migrate
  ```

  `migrate` only migrates, and `--no-deps` keeps Compose from starting its own `db`. It
  runs in a container, so the URL it connects to must name a host the container can
  reach, not `localhost`. Never `docker compose up` against production: that also starts the dev server and the
  demo seed, which refuses a database with users but not a new, empty one. Never run
  `db:seed` in production: it creates the demo logins.

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
  `X-Frame-Options: DENY`. API responses, `/sign-in` and every response that sets a
  cookie are `Cache-Control: no-store`. A proxy should not add a second CSP, since
  browsers enforce both and allow only what both allow, and an HSTS it adds should match
  this one.
- **The proxy must pass the public host:** forward the original `Host`, or set
  `X-Forwarded-Host` to it. A write from a browser that sends no `Sec-Fetch-Site` (Safari
  before 16.4, so iPhones on iOS 15 and 16.0 to 16.3) is checked by comparing its `Origin`
  with that host, and refused with `403` if the server sees only the proxy's. Those
  members still sign in, but nothing they record ever sends. Caddy and Traefik pass it by
  default; nginx needs `proxy_set_header Host $host;` (or `X-Forwarded-Host $host`).
- **`rateLimit.trustedProxyHops`:** set to the number of reverse proxies in front of the
  app that append to `X-Forwarded-For`; leave `0` with none. The per-client sign-in budget
  counts the entry that many places from the right, since anything further left the client
  wrote itself; with `0` there is no per-client budget. Next only fills the header when it
  is absent, so with no proxy every address in it is the client's to choose. **Get the
  count right, and count every proxy that appends, the platform's load balancer
  included.** Each wrong count fails differently:
  - **Too low:** every client is keyed on a proxy's own address, so everyone shares one
    bucket of `signInAttemptsPerClient` (30) that anyone can spend to block every new
    sign-in. Nothing warns about this, because a proxy's address is a valid one.
  - **Too high:** a client that sends its own `X-Forwarded-For` chooses its key, so it can
    rotate past the per-client budget. Clients that send none get no usable entry.
  - **A proxy that writes `ip:port` entries** (some do; Azure App Service is one reported
    case) also leaves no usable entry.

  With no usable entry, every sign-in lands in one unattributed bucket of 30 shared by
  everyone, and the logs show the throttled warning
  `Sign-in from no usable X-Forwarded-For entry`. After deploying, check the count
  directly: in `X-Forwarded-For` as the app receives it (the innermost proxy's access log
  shows it), the client's real address must be exactly `trustedProxyHops` places from
  the right.

- **Request bodies:** the API refuses a body over 256 KiB, or over 1.5 MiB for
  `/api/visits/sync`, with `413 content_too_large`. A full sync batch fits under that, so
  a reverse proxy's own limit should be at least 1.5 MiB; nginx's `client_max_body_size`
  defaults to 1 MB. Next also cuts any body the proxy sees at 2 MiB
  (`experimental.proxyClientMaxBodySize`, set from `src/server/http/body-limit.ts`)
  rather than refusing it, and logs a warning naming the route. On the API a cut body is
  still refused `413`; on Auth.js's sign-in routes the cut is the only bound.
- **Database connections:** one `pg` pool per process, which on Vercel means one per
  function instance: at most 10 connections, each closed after 5 s idle
  (`src/db/client.ts` says why). The pool is handed to `attachDatabasePool` from
  `@vercel/functions`, which keeps an instance awake until its idle connections have
  closed, so Vercel never suspends one holding a connection the database may drop in the
  meantime. It acts only where `VERCEL_URL` and `VERCEL_REGION` are set, as Vercel sets
  them on its functions; in the image, Compose, the stage stack and the tests it does
  nothing. Changing `database.url` needs a restart, or on Vercel a new deployment. A
  dropped connection fails that request with a `500` and is replaced.
- **Neon** (production): the app connects through Neon's pooled host, which runs
  PgBouncer in transaction mode, and migrations through the database's direct host, as
  Neon advises. The two hosts differ only by `-pooler` after the endpoint's name; Neon's
  Connect dialog shows the pooled one with "Connection pooling" on. Transaction mode
  gives each transaction whichever server connection is free, so the app keeps nothing
  on a connection past one: no session `SET`, `LISTEN` or `NOTIFY`, session-level
  advisory locks, temporary tables or named prepared statements (Drizzle's are unnamed).
  Keep it that way. `create-admin`, whose lock is released with its transaction,
  `db:check-blank` and `db:seed` use `database.url` like the app.

  **One-time change on Vercel**, to move production onto the pooler (#250):
  1. Wait until production runs a build that includes #250. A build without it refuses
     `database.migrationUrl` as an unknown key and does not start. If Preview has a
     `CONFIG_YAML` of its own, change it only once every branch it deploys includes #250
     too.
  2. In the project's **Settings → Environment Variables**, edit `CONFIG_YAML` for
     Production. Under `database`, add `migrationUrl` with the direct host, the one
     without `-pooler` that `url` names today, then add `-pooler` to `url`'s host. Keep
     the same database and query string in both, with no username or password in
     either. Only `sslmode` and `application_name` are allowed, so leave out the
     `channel_binding` that Neon's own connection strings add. Change nothing else:

     ```yaml
     database:
       url: postgresql://<endpoint>-pooler.<region>.aws.neon.tech/<database>?sslmode=require
       migrationUrl: postgresql://<endpoint>.<region>.aws.neon.tech/<database>?sslmode=require
     ```

  3. Leave `DATABASE_USER` and `DATABASE_PASSWORD` as they are: the same Neon role signs
     in on both hosts.
  4. Redeploy production (**Deployments**, the current production deployment,
     **Redeploy**): a change to `CONFIG_YAML` reaches only a new deployment.
  5. Sign in and open a block. Then run `npm run db:migrate` from a checkout, with
     `CONFIG_YAML` set to the same text and the same credentials exported: it reaches the
     direct host and prints `migrations applied`. Keep migrating that way from now on.

- **Accounts:** admins add members on **Admin → Team**, and approve there anyone who
  asks to join with Google. A fresh database has no admin to do either, so after
  migrating, create the first one from the same place you ran `db:migrate`, with the same
  `config.yaml` and credentials:

  ```bash
  npm run create-admin -- --email lead@example.org --name "Lead Organiser"
  ```

  It prompts twice for the password without echoing it. With Google sign-in set up in
  `config.yaml` and an address in `auth.google.domains`, leave the password empty to make
  an admin who signs in with Google only; it then asks for the email again, since a typo
  would leave an admin nobody can sign in as. Without a terminal, point
  `ADMIN_PASSWORD_FILE` at a file holding it, or read it into the environment unechoed
  with `read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD`.
  Setting `ADMIN_PASSWORD` directly is meant for orchestrators and secret managers, not
  for typing at a prompt.
  There is no `--password` flag, so through the prompt or the file the password never
  lands in shell history or `ps`. The email and password follow the rules of
  **Admin → Team** (a valid address, and a password of 8 to 200 characters when there is
  one). A Google-only admin needs a terminal.
  The script refuses, changing nothing, if any admin already exists, deactivated ones
  included: later admins are added in the app. It also refuses an address that already
  belongs to an account, since it only ever creates one. That includes an address that
  asked to join with Google before there was an admin to approve it (#249): the refusal
  gives the `DELETE` that removes that request, with its Google link and sign-in, so the
  script can then be run again; or make the first admin at another address and approve
  the request on **Admin → Team**.

## Stage environment

`stage` is the release candidate (see [Branches](#branches)). Before it is merged to
`main`, run it in a stack shaped like production, with a year of records in it, and
measure it. The stack is [`docker-compose.stage.yml`](docker-compose.stage.yml), its own
Compose project (`door-to-door-stage`) with its own volumes and network, so it never
touches the dev stack, the test databases or their ports.

```bash
git switch stage       # or whichever branch you want to measure
npm run stage:up       # build and start it, waiting until it is healthy
npm run stage:seed     # load a year of records into its empty database
npm run stage:perf     # measure it; add -- --db-latency 220 for a far database
npm run stage:down     # stop it and delete its data
```

| Service     | Stands in for                  | What it is                                                                                                                                                       |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge`      | Vercel's edge                  | Caddy: HTTPS on `127.0.0.1:3400` from its own certificate authority, zstd and gzip, and `X-Forwarded-For`, `-Proto` and `-Host` to the app                       |
| `app`       | The Vercel function            | The Dockerfile's `runner` stage, the production build on Node 24, with one CPU and 2 GB. Settings from `CONFIG_YAML`: secure cookies, `trustHost`, one proxy hop |
| `toxiproxy` | The network between them       | Relays every query the app makes; its API on `127.0.0.1:3401` adds a delay for `--db-latency`                                                                    |
| `db`        | Neon                           | PostgreSQL 17, the dev stack's image, published nowhere                                                                                                          |
| `migrate`   | Migrating before a deploy      | The real migration runner (`npm run db:migrate`); `app` starts only once it succeeds                                                                             |
| `secret`    | The deployment's `AUTH_SECRET` | Made once per stack and kept in its volume, or `STAGE_AUTH_SECRET` from your shell; never in the repository                                                      |
| `seed`      | -                              | Runs only for `npm run stage:seed`                                                                                                                               |

**The seed** loads 30 blocks, about 3,000 households and about 14,500 visits over the past
year: 48 weekly sessions, 4 follow-up sessions, one session active today and one waiting
to start, about 1,250 follow-ups (suggested, listed, done and removed), and 3 admins and
40 members, 2 of whom have left. Every run makes the same counts, ending at the moment it
runs, and the same moment gives the same records. It first prints
`Stage seed target: host:port/database`, then refuses, writing nothing, any database not
named `door_to_door_stage`, and any that holds a user, block, session, household, visit or
follow-up. It is not the demo seed and never runs against production. Its logins share
one published password, `stage-password`: `admin@stage.example.com` (admin) and
`member01@stage.example.com` to `member38@stage.example.com` (`member39` and `member40`
have left); the stack is on this machine's loopback only.

**The check** signs in as that admin and a member, then makes the requests each
screen makes, a page and then its API reads, in a phone's order: sign-in, home and the
active session, a block's units, a household's history, recording a visit, follow-ups,
Admin Sessions with its notices, All records (`/admin/history`) and Needs a return visit
(`/admin/attention`). It prints p50, p95 and maximum latency per route and the median
response size, decoded and as sent, as a Markdown table. It runs 20 rounds after 2
warm-up rounds, one phone at a time: it measures latency, not load. Each round records
a visit, so the stack's data grows a little with every run.

```bash
npm run stage:perf -- --iterations 10 --warmup 1 --db-latency 220 --json stage-results.json
```

Each round signs in as the next member, since one member may save only 30 visits a
minute, and a refusal shows in the `failed` column with its status. `STAGE_PORT` and
`STAGE_TOXIPROXY_PORT` move the published ports, for both Compose and the check.

`--db-latency <ms>` adds that round trip to every query the app makes, half each way,
and takes it off when the check ends. With none, the database is on the same Docker
network, as a function in Neon's region (`sin1` beside `ap-southeast-1`) nearly is. A
function in Vercel's default region for new projects, Washington, D.C. (`iad1`), is
about 220 ms from Singapore, and a request that makes several queries pays it each time.

**In a browser**, open https://localhost:3400. The certificate is the stack's own, so the
browser warns once; Chrome then refuses the service worker unless you trust the stack's
root certificate, which `stage:down` deletes with the stack:

```bash
docker compose -p door-to-door-stage -f docker-compose.stage.yml exec -T edge \
  cat /data/caddy/pki/authorities/local/root.crt > stage-root.crt
```

The edge drops the app's HSTS header, which would otherwise pin every port of `localhost`
to HTTPS, the dev server's included.

**What it does not model:** Vercel's cold starts, when a new function instance boots and
opens its database connections on its first request; Vercel's edge network and the
distance from a phone in Singapore to it (the check runs on this machine); Neon waking
from scale-to-zero, its TLS connections and its connection pooler; Google sign-in, which
needs a real OAuth client; many phones at once; mobile networks; and the browser's own
work, since the check fetches pages and API responses but runs no JavaScript.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot start: Configuration file not found at .../config.yaml` | Copy `config.example.yaml` to `config.yaml`, or point `CONFIG_PATH` at your file.                                                                                                                    |
| `Cannot start: AUTH_SECRET is not set` (or `DATABASE_USER`...)  | Export the variable in the shell that starts the server or script. `db:migrate`, `db:seed` and `db:reset` never read `.env`.                                                                         |
| `AUTH_SECRET must be a random value of at least 32 characters`  | It is short or looks like a placeholder (`changeme`, `example`...). Use `openssl rand -base64 32`.                                                                                                   |
| `Set either X or X_FILE, not both.`                             | Unset one of them.                                                                                                                                                                                   |
| `database.url: must not contain a username or password`         | Take the credentials out of the URL and export `DATABASE_USER` and `DATABASE_PASSWORD`.                                                                                                              |
| `Found a .env file ... It is not used for app settings`         | Next loaded a `.env` from the directory the server runs in. Move settings to `config.yaml`, export secrets, delete it.                                                                               |
| `Refusing to seed without --demo`                               | Type the flag: `npm run db:seed -- --demo`. Only ever on a development database.                                                                                                                     |
| `Refusing to seed ...: it has users that are not demo users`    | That database has accounts of its own, so the seed wrote nothing. Seed a fresh database instead; for Compose's, `docker compose down -v`, which deletes its data.                                    |
| `AUTH_SECRET is a public development value`                     | Compose's development secret reached a server outside `next dev`. Export your own: `openssl rand -base64 32`.                                                                                        |
| `403` "This development server answers only on localhost."      | `npm run dev` was reached by another name, such as a LAN address or a tunnel. Open http://localhost:3000; for a phone, use the production build (see Quick start without Docker).                    |
| `TEST_DATABASE_URL is not set` from the integration project     | Export it, e.g. `postgresql://postgres:postgres@localhost:5433/door_to_door_test`, with `docker compose up -d db-test` running.                                                                      |
| The E2E suite cannot reach its database                         | It needs PostgreSQL on `localhost:5433` (`docker compose up -d db-test`), or set `E2E_DATABASE_URL`.                                                                                                 |
| `check constraint "..._not_blank" ... is violated by some row`  | `db:migrate` met a blank unit, note, block name or street stored before #119. Run `npm run db:check-blank` to list them.                                                                             |
| Members see "No session is running"                             | An admin starts one: **Admin**, open the session, **Start session**. Only one runs at a time.                                                                                                        |
| "This unit is not on this session's list"                       | Members record only the session's picks. An admin lists it, then **Add households** on the session's page, or records it.                                                                            |
| "This page expired." every time, over http                      | Safari on `localhost` or a LAN phone dropped the `Secure` CSRF cookie (`MissingCSRF` logged), so reloading does not help. Set `auth.secureCookies: false`.                                           |
| "That Google account can't sign in here."                       | Not on **Admin → Team**, outside `auth.google.domains` or spelled unlike Google's; unverified; a personal Google account on a Workspace domain; or deactivated. Add, fix or restore it.              |
| "Could not sign out."                                           | No signal, or the server could not end the sign-in (`EventError` logged). The phone is still signed in; try again.                                                                                   |
| "Google sign-in didn't finish."                                 | The round trip failed. Check that the OAuth client's redirect URI is `<public origin>/api/auth/callback/google` and that `AUTH_GOOGLE_SECRET` is right; the server log names the Auth.js error type. |
| Every phone shows "Signed out" after upgrading                  | Tokens from before sign-ins were recorded (#125) name no sign-in, so each phone signs in once more. Records not yet sent stay on the phone and send after.                                           |
| Older iPhones stay on "The server is busy" and never send       | The proxy hides the public host, so their writes get `403`. Pass `Host` or set `X-Forwarded-Host` (see Deployment).                                                                                  |
| A new deploy does not show up on a phone                        | Updates are prompted, never forced. The banner waits while the member still has records being sent; tap it once it appears.                                                                          |
| The service worker never registers in development               | By design: it is enabled only in production builds. Use `npm run build && npm run start:standalone`.                                                                                                 |
| The dev server does not hot-reload in Docker                    | Compose sets `WATCHPACK_POLLING`; if you run `next dev` in another container, set it too.                                                                                                            |

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
  auth/         the Auth.js entrypoint, imported as @/auth, and Google sign-in
  server/       server-only services, auth (sign-ins, sign-out, guards), withContract,
                and the stage check (stage/)
  db/           Drizzle schema, client, seed data and the seed's guard, and the stage
                seed
  generated/    generated from openapi.yaml - never edit by hand
  proxy.ts      optimistic sign-in redirect (Next 16's name for middleware); under
                next dev, also refuses a Host that is not localhost
drizzle/        generated migrations - never edit by hand
e2e/            Playwright specs
test/           Vitest setup files and shared test helpers
scripts/        migrate, seed, create-admin, check-blank-text, generate-icons,
                check-standalone (postbuild), record-migration-checksums, e2e-linux,
                ci-changes, ci-e2e, stage-seed, stage-perf
docker/stage/   the stage stack's edge (Caddyfile) and toxiproxy settings
docs/           architecture, research and per-issue decisions
```

## Branches

| Branch      | Holds                                       | Changes arrive by                                                    |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------- |
| a feature's | One issue                                   | Commits                                                              |
| `dev`       | New features                                | A pull request per feature, squash or rebase merged                  |
| `stage`     | The release candidate                       | A pull request from `dev`, merged with a merge commit                |
| `main`      | Production: Vercel deploys it to d2dsrg.com | A pull request from `stage`, once tested, merged with a merge commit |

`dev`, `stage` and `main` are protected: a change needs a pull request and the four
[CI](#ci) checks, and none of them can be force-pushed or deleted. `dev` takes squash or
rebase merges; `stage` and `main` take merge commits only. Feature pull
requests target `dev`, never `stage` or `main`. Promote `dev` to `stage`, test it in the
[stage environment](#stage-environment), then merge `stage` to `main`.

Dependabot's version updates target `dev` too (`target-branch` in
[`.github/dependabot.yml`](.github/dependabot.yml)). Its security updates ignore that
setting and open against `main`, the default branch: retarget each to `dev` before
merging it (`gh pr edit <number> --base dev`). None of the entry's other settings apply
to them either: they come without its groups, labels or commit prefix, and past its
`ignore` rules.

Promotions are the only merge commits. Squashed or rebased, a promotion would give `dev`
and `stage` the same changes under different commits, and every later promotion would
conflict over them. Work never flows back: a fix goes to `dev` and is promoted like
anything else.

## Contributing

Read [CLAUDE.md](CLAUDE.md): it holds the domain model and the working rules, each marked
as CI-enforced or convention. Check [`docs/tasks/`](docs/tasks/README.md) for prior
decisions before making one.

Branches are stacked: the first branch of a stack bases off `dev` and its PR targets
`dev`; each later one bases off the branch before it and targets that. Merge top-down,
and squash or rebase into `dev`: a merge commit there gives every branch above it phantom
conflicts. Only promotions are merge commits (see [Branches](#branches)).
