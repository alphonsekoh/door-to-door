# #5 · Docker Compose dev environment

- **Status:** Done (PR #48)
- **Phase:** 0 - Foundation
- **Depends on:** #8, #9

## Task

`docker compose up` is the whole setup: database, migrate-and-seed once, dev server.

## Decisions

- **D-05-1 · `web` waits on `migrate` (`service_completed_successfully`), which waits on
  `db`'s healthcheck.** _Why:_ the app can never start against an unmigrated database.
- **D-05-2 · Dev server polls for file changes.** _Why:_ bind mounts on macOS/Windows
  deliver no inotify events. _Research:_ R-11.
- **D-05-3 · `node_modules` and `.next` are anonymous volumes.** _Why:_ host copies hold
  platform-specific binaries (argon2).
- **D-05-4 · Separate `db-test` on 5433, tmpfs-backed.** _Why:_ integration tests must
  not touch dev data.
- **D-05-5 · `output: "standalone"`** for the production image (199MB).
