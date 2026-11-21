# #250 · Database connections on Vercel: Neon's pooler and a deliberate pool

- **Status:** In progress (PR #259, merged to `dev`)
- **Phase:** none (no milestone)
- **Depends on:** #87, #241, #247

## Task

From #247's recommendation 2, approved in full by the owner on 2026-11-21. On Vercel's
Fluid compute (sin1) each instance keeps its own `pg` pool with pg's defaults, so a busy
moment opens many direct connections to Neon (ap-southeast-1), and a connection left idle
through a suspension is found dead by a later request. The app moves onto Neon's pooled
host, migrations stay on the direct host, and the pool is sized and handed to Vercel on
purpose.

## Decisions

### Two URLs

- **D-250-1 · `database.migrationUrl`: optional, defaulting to `database.url`.** The
  direct host for migrations is a key under `database`, in `config.yaml` or `CONFIG_YAML`,
  checked by `url`'s own schema: no credentials, only `sslmode` and `application_name`,
  and an error names the key, never the value. It gets the same `DATABASE_USER` and
  `DATABASE_PASSWORD`. _Why:_ the owner approved a settings key that holds no credentials
  (D-75-2, D-75-3), and one Neon role signs in on both hosts. Leaving it unset changes
  nothing for Compose, the image, the stage stack or the tests, which each have one host.
  _Research:_ R-236.
- **D-250-2 · The app never sees `migrationUrl`, by type or by value.** `RuntimeConfig`'s
  `database` leaves it out, and `loadConfig` rebuilds `database` as `{ url }`. _Why:_
  every connection the app makes must go through the pooler. A direct connection per
  instance is exactly what the pooler is there to prevent (#247).
- **D-250-3 · Which command connects where.** `db:migrate` and drizzle-kit's `push` and
  `studio` use `loadMigrationDatabaseUrl` (`migrationUrl`, else `url`). `generate`
  connects nowhere. `create-admin`, `db:check-blank` and `db:seed` keep
  `loadDatabaseUrl` (`url`), as the app does. Both loaders read the settings through
  `loadAppConfig`. _Why:_ Neon advises migrating on the direct host, and `push` changes
  the schema just as `migrate` does. The other scripts keep nothing past a transaction.
  `create-admin`'s `pg_advisory_xact_lock` (D-105-5) is released at commit or rollback,
  so it still holds through transaction pooling, and `check-blank` only reads.
  _Research:_ R-236.
- **D-250-4 · Two URLs naming different databases are not refused (scope cut).** Each URL
  is checked against its own rules only. The README says to keep the same database and
  query string in both. _Why:_ the hosts differ by design. A check on the database name
  alone would still pass a wrong host, so owner step 5 of D-250-11 is the real check.

### Session state

- **D-250-5 · Nothing may keep session state on a connection.** Transaction mode lends a
  server connection for one transaction only. So no session `SET`, `LISTEN` or `NOTIFY`,
  session-level advisory locks, temporary tables or named prepared statements, in the app
  or in any script on `url`. The README says to keep it that way. Checked on this branch,
  none appear in `src`, `scripts` or `drizzle/*.sql`. The one advisory lock is
  `first-admin.ts`'s transaction-scoped one, `FOR UPDATE` locks end with their
  transaction, and Drizzle names a statement only through `.prepare()`, which nothing
  calls. _Why:_ through the pooler, session state lands on whichever server connection
  the next transaction is given. _Research:_ R-236, R-237.

### The pool

- **D-250-6 · `max` 10 and `idleTimeoutMillis` 5000, as named constants whose comment
  says why.** `max` is per instance. Neon's pooler, not this, bounds the database's own
  connections, and ten lets ten requests query at once (Home fires three or four together,
  #247). The idle timeout is how long an attached instance outlives its last query
  (D-250-7), and a reconnect from sin1 costs about 10–20 ms, so it is short. Vercel
  suggests about 5 s. _Why:_ pg's defaults (10, 10 s) were never chosen.
  _Trade-off:_ wherever the app runs, a gap of over 5 s now pays a reconnect.
  _Research:_ R-234, R-237. _Reasoning restated by D-252-1 (#252):_ one request can now
  hold up to five connections, so ten serve two or three such requests at once, and
  later queries wait for a free one (R-258). The number is unchanged.
- **D-250-7 · The app's pool goes to `attachDatabasePool`, after
  `attachPoolErrorHandler`.** On Vercel each release keeps the instance awake through
  `waitUntil` for the idle timeout plus 100 ms. So no connection survives a suspension for
  a later request to find dead. It acts only where both `VERCEL_URL` and `VERCEL_REGION`
  are set. In the image, Compose, the stage stack and the tests it does nothing. The
  scripts' one-connection pools are not attached, because they never run on Vercel. The
  app pool is still the process-wide singleton (D-87-3), attached once. _Why:_ an idle
  timer does not run while an instance is suspended. _Research:_ R-234.
- **D-250-8 · Imported from `@vercel/functions/db-connections`, not the package root.**
  _Why:_ the root loads every module, one of which pulls in `@vercel/oidc` and a CLI
  helper that spawns processes. The subpath loads only the request context and the
  deadline. The builder checked the build output: it holds the attach code and no
  `@vercel/oidc`. _Research:_ R-235.
- **D-250-9 · `@vercel/functions` is pinned exactly at `3.11.3` (new dependency, owner
  approved).** It is pinned like D-111-2, D-118-1 and D-131-7. The lockfile gains 18
  packages, all from `registry.npmjs.org` and none with an install script. Six packages
  that were there only for dev tools lose `dev: true`, because `@vercel/oidc` →
  `@vercel/cli-exec` → `execa` needs them: `cross-spawn`, `isexe`, `path-key`,
  `shebang-command`, `shebang-regex` and `which`. `src/supply-chain.test.ts` passes
  unchanged. _Why:_ since D-131-8 a new package is the owner's call, and nothing in its
  tree runs at install. _Research:_ R-235.

### Environment and the owner's edit

- **D-250-10 · `VERCEL_URL` and `VERCEL_REGION` join the README's environment table:
  Vercel sets them, and nothing else should.** The app reads neither. `@vercel/functions`
  does. This refines D-75-7: the app adds no variable of its own, and the table now names
  two that the platform sets, as D-38-6 names `AUTH_URL` for Auth.js. _Why:_ set
  anywhere other than Vercel, they make the attach look for a request context that is
  not there, and it logs a warning on every release. _Research:_ R-234.
- **D-250-11 · The owner's one-time `CONFIG_YAML` edit on Vercel, in this order.**
  (1) Production first runs a build that includes #250. Preview's `CONFIG_YAML` changes
  only once every branch it deploys includes #250 too. (2) Under `database`, add
  `migrationUrl` set to the direct host that `url` names today, then add `-pooler` to
  `url`'s host. Both keep the same database and query string, with no credentials and no
  `channel_binding`. (3) The credentials stay as they are. (4) Redeploy. (5) Sign in and
  open a block, then run `db:migrate` from a checkout and see `migrations applied`. The
  steps are in README Deployment and in the PR's Before merging, with placeholders only.
  _Why:_ a build without #250 refuses the new key as unknown (D-75-4) and does not
  start. A `CONFIG_YAML` change reaches only a new deployment (D-241-4). The repository
  is public.
- **D-250-12 · Tests: unit and integration, no E2E.** Unit tests pin the pool options
  and the attach call, and the singleton attached once. An integration test runs a real
  pool with the Vercel variables set: the connection closes at 5000 ms and `waitUntil`
  resolves at 5100 ms. With them unset, nothing is held and nothing warns, even inside a
  request context. Config tests cover the key's rules, an error naming the key, both
  loaders, and the app's config without `migrationUrl`. _Why:_ the change is
  server-only, and D-37-6 keeps the E2E suite thin.

## How existing decisions are handled

None is superseded.

| Decision       | Effect                                                                                                                  | By       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| D-75-2, D-75-3 | Kept: `migrationUrl` holds no credentials and is refused like `url`                                                     | D-250-1  |
| D-75-4         | Kept: the unknown key is why the owner's edit waits for a build with #250                                               | D-250-11 |
| D-75-7         | Refined: the environment table names the platform-set `VERCEL_URL` and `VERCEL_REGION`, read by a dependency            | D-250-10 |
| D-241-3        | Refined: `loadMigrationDatabaseUrl` also reads the settings through `loadAppConfig`                                     | D-250-3  |
| D-105-1        | Refined: `create-admin` reads `database.url`. "Like `db:migrate`" now means the same settings and credentials           | D-250-3  |
| D-119-12       | Refined: `check-blank` connects to `database.url`, and `migrate` to `migrationUrl` when it is set                       | D-250-3  |
| D-105-5        | Kept: the transaction-scoped advisory lock holds through transaction pooling                                            | D-250-3  |
| D-87-1, D-87-3 | Kept: every pool keeps `attachPoolErrorHandler`, and the app's pool is one per process, which on Vercel is per instance | D-250-7  |
| D-75-9, D-13-4 | Kept: the attach runs in `createDatabase`, reached lazily, so nothing loads at module scope                             | D-250-7  |
| D-38-12        | Kept: production migrates from a checkout, now at the direct host                                                       | D-250-11 |

## Evidence

- Builder at e509d5d: lint, typecheck, format, `test:coverage` (5171 tests), the build
  and 39 Chromium E2E pass. The build output holds the attach code and no `@vercel/oidc`.
- Reviewer r0: pass, no blockers. Full integration project on its own database: 45 files,
  1175 tests. Unit tests for the client, config and supply chain: 195.
- The docs step re-ran the session-state search of D-250-5 and the lockfile comparison
  of D-250-9, and both match.

## Known limits

- Nothing was measured on a real Vercel deployment or through Neon's pooler. The stage
  stack (#244, PR #253) is not on `dev`, so the issue's "the stage stack still boots"
  is owed once both are there.
- After the `CONFIG_YAML` edit, a fresh deployment of any commit before #250 refuses to
  start (D-250-11). Vercel's Instant Rollback should keep the environment that deployment
  was built with, but nobody has checked (Open questions).
- With the shorter idle timeout, `stage:perf` runs with gaps of over 5 s pay a reconnect
  through toxiproxy, as production does.
- `DEBUG`, set to any value, makes `@vercel/functions` log every pool release. It logs
  no values, and it is not in the environment table.
- A `migrationUrl` naming another database is accepted (D-250-4).
- One unrelated flake: `active-session.test.tsx`'s "explains how it works once, until
  dismissed on this phone" failed once under load in `npm test`, as in #226. No
  component changed.

## Relies on

D-13-4, D-37-6, D-38-12, D-75-2, D-75-3, D-75-4, D-75-5, D-75-9, D-87-1, D-87-3, D-105-5,
D-131-8, D-241-1, D-241-4.

## Open questions

- **Owner check before relying on a rollback:** does Vercel's Instant Rollback to a
  deployment from before #250 run with the `CONFIG_YAML` that deployment was built with?
  If it runs with the edited one, that deployment refuses `migrationUrl` and does not
  start.
