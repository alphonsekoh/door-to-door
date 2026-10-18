# #38 · Final documentation pass

- **Status:** Done (PR #104)
- **Phase:** 7 - Hardening

## Task

README, CLAUDE.md and `.env.example` reconciled with what was built; the OpenAPI
workflow and offline model documented; ADR-style notes for contested decisions.

## Decisions

- **D-38-1 · Decisions live in `docs/tasks/`, one file per issue, with stable IDs.**
  These serve as the ADRs the issue asks for: household/visit split (D-07-1, D-07-2),
  JWT sessions (D-13-1), one active session (D-07-4), Serwist (D-32-1, now D-32-2).
- **D-38-2 · `docs/` is maintained by the `docs` agent** as part of every task.
- **D-38-3 · The ADR notes are a "Contested decisions" section in `ARCHITECTURE.md`**
  (context, decision, why, consequences), each citing its task records; no `docs/adr/`.
  _Why:_ D-38-1 already makes the task records the ADRs; a second copy would drift.
- **D-38-4 · Google SSO is documented as "not built (#14)"**, and `auth.google.clientId`
  and `AUTH_GOOGLE_SECRET` stay documented as reserved. _Why:_ both exist and are
  validated at startup; leaving them out would mislead. Reword when #14 lands.
- **D-38-5 · `.env.example` is a placeholder-only checklist of variables to export**, not
  a file the app relies on; tracked through `!.env.example`. Relies on D-75-2 and D-75-16.
  _Why:_ the issue asks for it and contributors need one list. _Amended (fix round 3):_
  this first said D-75-16 means "no `.env` is read". Wrong: Next (`dev`, `build`) and
  drizzle-kit (`db:generate`, `db:push`, `db:studio`) load it, `start:standalone` reads
  the copy `build` made, and only the `tsx` scripts (`db:migrate`, `db:seed`, `db:reset`)
  skip it. D-75-16 only adds a warning. _Research:_ R-28, R-53. Owner confirmed (D-38-22).
  _Refined by D-106-5:_ the build now deletes that copy, so `start:standalone` reads no `.env`.
- **D-38-6 · The README env table is derived from the code, not the old docs:** secrets
  from `src/lib/config.ts`, process variables per D-75-7, plus Compose, test, E2E and
  fuzz variables from `docker-compose.yml`, `playwright.config.ts` and the tests, and
  `AUTH_URL` (read by Auth.js itself). `NEXT_PHASE` and `NEXT_RUNTIME` are left out as
  Next-internal. _Why:_ the acceptance bar is "no doc references code that doesn't exist".
- **D-38-7 · CLAUDE.md now describes what was built:** `@serwist/turbopack` (D-32-2),
  email + password on JWT (D-13-1), the real E2E suite on Chromium and WebKit (D-32-18),
  "outing" vs "session" and teammate amends (D-74-22), visits "never overwritten by a later
  visit" (an amend corrects the same visit), Configuration rules (D-75-1, D-75-17), and
  `format:check` in the pre-done commands. _Why:_ stale guidance is worse than none.
- **D-38-8 · The migration rule is split:** **[CI]** for snapshot drift (CI reruns
  `db:generate` and checks `drizzle/`), **[convention]** for no hand-written or hand-edited
  SQL. Refines D-08-1. _Why:_ the CI check never reads the `.sql` files, so calling the
  whole rule CI overstated it (D-02-1).
- **D-38-9 · Agent prompts brought up to date:** verifier (WebKit covered except the
  three offline-navigation tests, D-32-18; "existing specs", not "three flows"), reviewer
  (teammates may amend, D-74-22), docs (may edit `.env.example`), builder (runs
  `format:check`, which CI's static job runs).
- **D-38-10 · `npm start` is an alias for `start:standalone`**, not deleted. _Why:_
  `next start` cannot serve standalone output, and the conventional command should work.
  _Research:_ R-12.
- **D-38-11 · `spec:preview` runs `redocly build-docs` into `.next/api-docs.html`.**
  _Why:_ Redocly CLI 2 removed `preview-docs`; `build-docs` needs no network or licence,
  and `.next/` is already ignored. _Research:_ R-52.
- **D-38-12 · Production migrations run from a checkout or a `dev`-stage container;** the
  Dockerfile comment claiming the image can migrate itself was corrected. _Why:_ the
  runner image copies `drizzle/` but has no runner. Scope cut: bundling one is open below.
- **D-38-13 · Deployment notes are provider-neutral** (image, read-only config mount,
  env secrets, migrate before start, HTTPS for the worker). _Why:_ no host is chosen.
- **D-38-14 · Screenshots are seed data only**, phone width (393 px), small PNGs in
  `docs/screenshots/`. _Why:_ never real people; kept light for the repo.
- **D-38-15 · Left out:** a first-admin bootstrap (README says insert by hand until #105), a
  migration runner in the image, and the `.next/standalone/config.yaml` copy. `docker
compose up` itself was not run (only `docker compose config`). _Why:_ code changes
  beyond a docs pass. Now tracked: first admin #105 (D-38-21), frozen standalone config
  #106 (D-38-23), image migration a separate code issue if wanted (D-38-20).

- **D-38-16 · The README says to export variables, and tabulates which commands read
  `.env`,** rather than telling contributors to use one. _Why:_ the `tsx` db scripts never
  load it, so a `.env` works for `dev` and fails for `db:migrate` (R-53).
- **D-38-17 · `.env.example` suggests a file outside the repo**, sourced with
  `set -a; . ~/door-to-door.env; set +a`, not `.env.local`. _Why:_ Next loads `.env.local`
  too, which would trip the D-75-16 warning and still miss the `tsx` scripts.
- **D-38-18 · Owner: Google SSO stays "not built yet (#14)";** confirms D-38-4.
- **D-38-19 · Owner: hosting is not chosen;** deployment notes stay provider-neutral
  (D-38-13) until it is.
- **D-38-20 · Owner: production migrations run from a checkout or a `dev`-stage container
  for now** (D-38-12). Making the image migrate itself would be a separate code issue.
- **D-38-21 · Owner: first admin on a fresh database is #105** (a `create-admin` script
  that refuses if an admin exists). The README's insert-by-hand note points at it.
- **D-38-22 · Owner: keep `.env.example` (D-38-5), `npm start` as an alias (D-38-10) and
  `spec:preview` via `build-docs` (D-38-11).**
- **D-38-23 · Owner: the frozen `.next/standalone/config.yaml` is #106.**
- **D-38-24 · Owner: the `Read(./.env.*)` deny (D-02-4) stays as is for agents;** the
  owner decides the permission rule. Agents do not change settings.

## Relies on

D-02-1, D-02-2, D-02-4, D-08-1, D-10-1, D-12-1, D-13-1, D-32-2, D-32-18, D-37-1, D-74-22,
D-75-1, D-75-2, D-75-7, D-75-16, D-75-17.

## Open questions

- **Hand-deployed standalone folder:** `build` also copies `.env` into
  `.next/standalone/` (R-28). The Docker build excludes it, but a folder copied to a server
  by hand would carry secrets. Fold into #106, or a separate issue?
