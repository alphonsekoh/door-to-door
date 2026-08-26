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

- Installable on a phone, works offline, and syncs when signal returns _(not yet — #32, #33)_

## Requirements

- Node.js 20+ (developed on 24)
- npm 10+
- Docker Desktop — for PostgreSQL _(not yet — #5)_

## Quick start

```bash
git clone https://github.com/alphonsekoh/door-to-door.git
cd door-to-door
npm install
npm run dev
```

Open http://localhost:3000.

There is no database or login yet, so the app runs as a navigable shell with placeholder
screens. Each placeholder names the issue that replaces it.

### With Docker _(not yet — #5)_

Once the database lands, this becomes the one-command path — it starts PostgreSQL, applies
migrations, seeds demo data and runs the app:

```bash
cp .env.example .env
docker compose up
```

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

| `npm test` | Run all three test projects |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:unit` | Unit project only |
| `npm run test:integration` | Integration project only |
| `npm run test:components` | Component project only |
| `npm run test:coverage` | Run tests and enforce coverage thresholds |

| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema straight to the database (dev only) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:seed` | Seed deterministic demo data |
| `npm run db:reset` | Migrate then seed |

_(not yet)_ `npm run generate:api` (#11)

## Environment variables

| Variable                                | Used by                   | Arrives in |
| --------------------------------------- | ------------------------- | ---------- |
| `DATABASE_URL`                          | Drizzle, migrations, seed | #7, #8     |
| `AUTH_SECRET`                           | Auth.js session signing   | #13        |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google SSO                | #14        |

## Database

```bash
cp .env.example .env          # set DATABASE_URL
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
npm test              # all three projects
npm run test:coverage # with thresholds enforced
```

Vitest runs three projects — `unit` (node), `integration` (node, against a real PostgreSQL
once #7 lands) and `components` (jsdom + Testing Library). Test files are picked up by
suffix: `*.test.ts` is a unit test, `*.integration.test.ts` an integration test, and
`*.test.tsx` a component test.

Coverage is enforced per-glob: **100%** for `src/server/**`, `src/lib/**`, `src/app/api/**`
and `src/db/**`; **90%** for `src/components/**` and `src/app/**`. Generated output,
migrations and `layout.tsx` are excluded.

## How the API is built

`openapi.yaml` is the source of truth _(arrives in #10)_. Types, Zod validators and the
frontend client are generated from it with `@hey-api/openapi-ts`; CI fails if the generated
output drifts from the spec. Every route handler validates both its request **and its
response** against the contract, so a response that diverges fails a test rather than
shipping.

The workflow is: **edit the spec → regenerate → implement.** Never the other way round.

## Contributing

Read [CLAUDE.md](./CLAUDE.md) — it holds the domain model and the working rules, each
marked as CI-enforced or convention.

Branches are stacked: a feature branch bases off the previous one and its PR targets that
branch rather than `main`. Merge top-down, and squash or rebase rather than creating a
merge commit.
