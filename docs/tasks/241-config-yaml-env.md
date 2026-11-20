# #241 · Settings from a CONFIG_YAML environment variable

- **Status:** In review (PR #242)
- **Phase:** 7 - Hardening
- **Depends on:** #75

## Task

The app reads its settings from `config.yaml` at startup. A host with no place for a
runtime file, Vercel in particular, cannot supply them without making the file part of
the deployment bundle, which the build refuses (`postbuild` fails if a `config.*.yaml`
reaches `.next/standalone`). The owner chose (2026-11-20) to let the same YAML come from
one environment variable rather than relax that rule.

## Decisions

- **D-241-1 · `CONFIG_YAML` holds the settings text and is used in place of the file.**
  When it is set and not empty it is parsed with the file's strict schema and named
  `CONFIG_YAML` in errors. Credentials in it are still refused, and unknown keys are
  still errors. An empty value counts as unset, as `CONFIG_PATH` does. _Why:_ one schema
  and one set of rules for both sources, so a setting means the same wherever it comes
  from. _Not taken:_ baking a `config.vercel.yaml` into the build, which would supersede
  D-75-19's rule that the build holds no settings; a second, JSON or per-key set of
  variables, which the strict schema would then have to cover twice.
- **D-241-2 · `CONFIG_YAML` with `CONFIG_PATH` is a startup error.** It says to set one.
  An empty `CONFIG_PATH` beside `CONFIG_YAML` is allowed. _Why:_ the same rule as `X`
  and `X_FILE` for secrets, since two sources would leave it unclear which one applied.
- **D-241-3 · Every reader of the config follows.** The server, `db:migrate`,
  `db:seed` and `create-admin` all reach it through `loadAppConfig`, so none needs a
  file. _Why:_ a deployment migrates and creates its first admin from outside the host.
- **D-241-4 · The build is unchanged.** `next build` still reads no settings and
  `postbuild` still fails on a `config.*.yaml` in the output. _Why:_ the variable is read
  at runtime only, so D-75-19 holds as written. A change to it needs a new deployment on
  Vercel, as an edit to the file needs a restart elsewhere.
- **D-241-5 · `npm run start:standalone` leaves `CONFIG_PATH` unset when `CONFIG_YAML`
  is.** The script used to default `CONFIG_PATH` to `./config.yaml`, which would have made
  every `CONFIG_YAML` start an error under D-241-2. _Why:_ found when the build was run
  from `CONFIG_YAML` with no file; the image and Vercel start the server without the
  script. The default is unchanged when `CONFIG_YAML` is not set.
- **D-241-6 · Tests, no E2E.** Five loader tests and one `loadDatabaseUrl` test cover both
  sources, the conflict, the empty value, the schema and the refusal of credentials, to
  the 100% the loader's folders require (D-37-6). The build, `db:migrate`, `create-admin` and the app were also run from
  `CONFIG_YAML` with no file, and the 20-check smoke script passed.

## How existing decisions are handled

| Decision | Effect                                                                         | By      |
| -------- | ------------------------------------------------------------------------------ | ------- |
| D-75-19  | Kept: the build and the image hold no settings                                 | D-241-4 |
| D-75-3   | Kept: credentials in `database.url` are refused, from either source            | D-241-1 |
| D-13-4   | Kept: nothing loads config at module scope, and `next build` needs no variable | D-241-4 |

## Known limits

- A `CONFIG_YAML` value is an environment variable on the host, so it is visible to
  anyone who can read the project's settings there. It holds no secrets by design.
