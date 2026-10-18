# #106 · Standalone build copies config.yaml and .env into its output

- **Status:** In review (PR #107)
- **Phase:** 7 - Hardening
- **Depends on:** #75, #38

## Task

A local `npm run build` left `config.yaml` and `.env` in `.next/standalone/`, so
`start:standalone` or a hand-deployed folder read a config frozen at build time and
carried secrets. Docker was unaffected (`.dockerignore`). Found in #38 (D-38-23).

## Decisions

- **D-106-1 · Fix the config trace at the source: `turbopackIgnore` goes inside each
  `join(cwd, ...)` in `src/server/config.ts`,** not only on the `readFileSync`/`existsSync`
  argument, and not via `outputFileTracingExcludes`. _Why:_ Turbopack resolves
  `join(process.cwd(), "config.yaml")` to a project file and traces it into every server
  entry (instrumentation, proxy, route handlers); the comment on the fs call never stopped
  it. Extends D-75-14. _Research:_ R-55.
- **D-106-2 · The build deletes the `.env` and `.env.production` that Next copies to the
  standalone root,** rather than failing and asking the developer to remove `.env`.
  _Why:_ Next copies them on every build that loaded them and no option, including
  `outputFileTracingExcludes`, stops it; failing would break every local build that has a
  `.env`. Pending owner confirmation (Open questions). _Research:_ R-54.
- **D-106-3 · `postbuild` (`scripts/check-standalone.ts`, logic in
  `src/server/standalone-output.ts`) fails the build if any `.env*`, `config.yaml` or
  `config.*.yaml` is left anywhere in `.next/standalone/`, skipping `node_modules`.**
  _Why:_ a guard on the real output catches any future import that re-traces the file;
  as `postbuild` it also runs in the Docker builder and before the E2E server (D-37-1).
  Unlike `.dockerignore` it makes no exception for `config.example.yaml` or
  `config.docker.yaml`: neither belongs in the output either.
- **D-106-4 · CI plants a deliberately invalid decoy `config.yaml` and a `.env` before
  `npm run build`.** _Why:_ a trace only copies files that exist, so without decoys the
  check has nothing to catch; the invalid config keeps D-13-4 tested, since a build that
  read it would fail.
- **D-106-5 · `start:standalone` reads no `.env` and no frozen config:** its config is
  `CONFIG_PATH`, defaulting to `$PWD/config.yaml` from where it is launched. README's
  `.env` table, script row and troubleshooting row now say so. Refines D-38-5, whose
  amendment said `start:standalone` reads the copy `build` made; that is no longer true.
- **D-106-6 · Fix round 1: the `.env`-named-directory test now exercises the `isFile`
  guard in `pruneDotEnv`.** _Why:_ the first version passed without it, so it proved
  nothing.

## Relies on

D-13-4, D-37-1, D-75-14, D-75-16, D-75-19, D-38-5, D-38-23.

## Open questions

- **Delete the copied `.env`, or fail the build and ask for `.env` to be removed?** The
  builder recommends delete (built, D-106-2): Next copies it every time with no setting to
  stop it, so failing would break every local build for anyone who keeps a `.env`. A
  traced `config.yaml` still fails the build.
