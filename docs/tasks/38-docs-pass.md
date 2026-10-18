# #38 · Final documentation pass

- **Status:** In review (PR #104)
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
  a file the app loads; tracked through `!.env.example`. Relies on D-75-16 (no `.env` is
  read) and D-75-2. _Why:_ the issue asks for it and contributors need one list.
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
- **D-38-15 · Left out:** a first-admin bootstrap (README says insert by hand), a
  migration runner in the image, and the `.next/standalone/config.yaml` copy. `docker
compose up` itself was not run (only `docker compose config`). _Why:_ code changes
  beyond a docs pass; each is an open question below.

## Relies on

D-02-1, D-02-2, D-08-1, D-10-1, D-12-1, D-13-1, D-32-2, D-32-18, D-37-1, D-74-22,
D-75-1, D-75-2, D-75-7, D-75-16, D-75-17.

## Open questions

Raised by the builder; the docs follow each recommendation until the owner decides.

- **Google SSO wording** (D-38-4): keep "not built yet (#14)", drop it, or say "planned"?
- **Hosting:** which provider, managed Postgres and HTTPS terminator? Then add a
  provider-specific deployment section (D-38-13).
- **Production migrations** (D-38-12): bundle `scripts/migrate.ts` into the runner image
  and document `docker run ... node migrate.js`, or keep migrating from a checkout?
- **First admin:** a fresh production database has none. Add a `create-admin` script
  (argon2id, refuses if an admin exists)?
- **`.claude/settings.json` denies `Read(./.env.*)`** (D-02-4), which also blocks agents
  from reading `.env.example` even though D-38-9 lets the docs agent edit it. Allow
  `Read(./.env.example)` or narrow the deny? Owner-only change.
- **Confirm** the fixes made without an explicit answer: keeping `.env.example` (D-38-5),
  `npm start` as an alias (D-38-10), `spec:preview` via `build-docs` (D-38-11).
- **`.next/standalone/config.yaml`:** a local `npm run build` copies `config.yaml` into the
  standalone output, and `node .next/standalone/server.js` without `CONFIG_PATH` reads that
  frozen copy. Docker and `start:standalone` are unaffected. File a follow-up bug?
