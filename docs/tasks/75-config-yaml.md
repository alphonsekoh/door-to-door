# #75 · Move configuration from .env to config.yaml

- **Status:** Done (PR #79)
- **Phase:** 6 - PWA & Offline
- **Depends on:** #13

## Task

All app settings live in a YAML file read from disk at runtime, never bundled, so a value
can be changed on a deployment with a restart and no rebuild. Secrets stay out of it.

## Decisions

- **D-75-1 · One YAML file, read at runtime, never imported.** `config.yaml` is
  gitignored; `config.example.yaml` and `config.docker.yaml` are committed. _Why:_ easy to
  read and change when deploying; nothing ends up in a bundle.
- **D-75-2 · Secrets are not in the file.** Database username and password, `AUTH_SECRET`
  and `AUTH_GOOGLE_SECRET` come from env vars, each with an optional `_FILE` variant;
  setting both `X` and `X_FILE` is an error. _Why:_ the file can be shared, mounted and
  committed-by-accident safely; `_FILE` fits Docker/Kubernetes secrets.
- **D-75-3 · `database.url` is refused if it carries credentials** in the userinfo or the
  query string (`user`, `password`, `ssl*` params). Credentials are percent-encoded when
  the URL is composed. _Why:_ the library lets a query-string password override the
  credentials, so checking userinfo alone is bypassable. _Research:_ R-26.
- **D-75-4 · Strict schema; typos fail.** _Why:_ a misspelled key silently falling back to
  a default is worse than a refusal.
- **D-75-5 · Error messages name the file, key or env var, never a value.** _Why:_ logs
  must not leak secrets.
- **D-75-6 · Placeholder and short (under 32 chars) `AUTH_SECRET` are rejected.** _Why:_
  the example value must not reach production. _Extended by D-124-7 (owner):_ a value
  matching `/not.?for.?production/i` is refused too, unless `NODE_ENV` is `development`.
- **D-75-7 · The only extra env vars are `CONFIG_PATH`** (default `./config.yaml`), plus
  `PORT`, `HOSTNAME`, `NODE_ENV` and `NEXT_*`; `CONFIG_FILE` selects the file for Compose.
- **D-75-8 · `TEST_DATABASE_URL` is the only place a full URL is allowed, and never falls
  back to `DATABASE_URL`.** _Why:_ tests truncate tables; a stray production URL must not
  be reachable.
- **D-75-9 · Lazy everywhere: config, rate limiter, proxy, db client.** Extends D-13-4.
  _Why:_ `next build` needs neither the file nor a database.
- **D-75-10 · `instrumentation.register()` validates at start and calls `process.exit(1)`
  on bad config;** skipped on edge and during build. _Why:_ Next otherwise keeps serving
  after a failed register.
- **D-75-11 · `proxy.ts` exports an async function.** _Why:_ `auth(handler)` with the lazy
  `NextAuth(fn)` form returns a Promise at runtime; unit tests missed it, a standalone run
  caught it. _Research:_ R-25.
- **D-75-12 · The proxy reads the file** (Next 16 proxy runs on Node), which corrects the
  old "edge runtime" comment. _Research:_ R-24.
- **D-75-13 · Supersessions (owner-approved, the owner asked for YAML).** Supersedes
  D-08-3 (`process.loadEnvFile`). Amends D-08-2 (`src/db/env.ts` replaced by the config
  modules; the split stays). Amends D-06-3 (`DATABASE_URL` becomes `TEST_DATABASE_URL`,
  principle kept). Replaces the E2E env block in D-37 with a generated config file and env
  secrets. _Why:_ one source of settings.
- **D-75-14 · The loader avoids `path.resolve`.** _Why:_ Turbopack then traces all of
  `src/server` into the standalone output. _Research:_ R-27.
- **D-75-15 · Rate limits and clock-skew tolerance are config keys.** Sign-in limit 10 per
  300 s; `sync.clockSkewToleranceSeconds` 300, used by #76 (D-76-1). _Why:_ settings in one
  place. _Refined by D-126-8 (owner, 2026-11-04):_ this covers the sign-in budgets and
  clock-skew tolerance. The per-member write limits, sync's (D-21-6) and `POST /visits`'s,
  are code constants.
- **D-75-16 · One-time `.env found and ignored` warning.** _Why:_ stale `.env` files would
  otherwise silently stop working. _Research:_ R-28.
- **D-75-17 · ESLint restricts importing `config`/`yaml` from `components` and `lib`.**
  _Why:_ keeps settings and the file reader out of client bundles. _Extended by D-14-18:_
  `src/auth` (`@/auth`, `@/auth/*` and relative paths) is refused there too.
- **D-75-18 · `yaml` is a runtime dependency.** _Why:_ the production image reads the file.
- **D-75-19 · Compose mounts the file at `/config/config.yaml` with a public, local-only
  dev `AUTH_SECRET`; the Docker runner never copies the file.** _Why:_ the image holds no
  settings; the dev secret is not sensitive. _Refined by D-124-7 (owner, 2026-11-13):_
  the dev secret is public, so it is "not sensitive" only under `next dev`; anywhere
  else the app refuses to start with it.

## Relies on

D-13-4, D-37-1.

## Open questions

None.
