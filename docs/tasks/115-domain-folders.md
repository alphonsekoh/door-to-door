# #115 · Group src/components and src/lib by domain

- **Status:** In review (PR #116)
- **Phase:** 7 - Hardening
- **Depends on:** none

## Task

`src/components` held 130 files in one folder and `src/lib` 76 loose files, so finding a
screen's code meant scanning an alphabetical list. A pure move into domain folders: no
behaviour change, no renamed exports.

## Decisions

- **D-115-1 · Domain folders inside the existing roots (owner).** `src/components/` gets
  `ui`, `shell`, `pwa`, `sync`, `visits`, `households`, `history`, `follow-ups`,
  `sessions`, `blocks`, `teams`, `admin`, `account`. `src/lib/` gets `pwa`, `teams`,
  `units`, `history`, `hooks`, `session`, beside the unchanged `sync` and `offline`;
  `config`, `openapi-document`, `api-client`, `clock`, `csv` and `uuid` stay at its top.
  _Why:_ no coverage glob, ESLint rule (D-75-17) or `@/` alias root changes, so every gate
  carries over as it was.
- **D-115-2 · Scope (owner).** `src/app`, `src/server`, `src/db`, `src/generated` and
  `drizzle/` do not move. Each file moves with its test; only imports, mocks, path
  strings and comments that name a moved file change. _Why:_ routes and server code are
  already laid out by path or domain, generated code is not ours to move, and a diff of
  renames is reviewable.
- **D-115-3 · `auth.ts` moves to `src/auth/index.ts`, imported as `@/auth` (owner).**
  Google SSO (#14) and its pieces land in the same folder. Refines D-13-5: the logic stays
  in `src/server/auth`, only the thin wrapper moves. _Why:_ #14 adds auth code of its own,
  and one folder keeps it together.
- **D-115-4 · `src/auth/**` is gated at 100%, and the wrapper gets its own test.**
  Amends D-04-2 (adds a glob, changes none), as D-36-10 did. _Why:_ at the root,
  `auth.ts` was outside `coverage.include`; under `src/` with no glob, a drop would still
  pass. The test pins D-13-4's lazy config.
- **D-115-5 · The three Vitest setup files move to `test/` (owner).** _Why:_ they are
  test harness, not tool config. Git shows the integration setup as a delete plus an add:
  one of its three lines changed.
- **D-115-6 · `config.example.yaml` and `config.docker.yaml` stay at the root (owner).**
  _Why:_ moving them touches the Dockerfile, Compose and the config loader for little
  gain.
- **D-115-7 · `overlay-layers.test.ts` stays at the root of `src/components` and walks
  every subfolder, naming files by folder (`ui/sheet.tsx`).** _Why:_ it guards every
  component's layer (D-30-7, D-85-4, D-111-13); reading only the top folder, which now
  holds no component, it would have checked nothing. _Research:_ R-78.
- **D-115-8 · A test goes with the module it imports.** `confirm-dialog.test.tsx` goes
  to `components/ui/`, since `ConfirmDialog` is in `ui/sheet.tsx`;
  `src/lib/contract-schemas.test.ts` stays at the top of lib. _Why:_ the latter tests the
  generated validators, which belong to no domain.
- **D-115-9 · The raw-auth import guard also catches `@/auth/index`.** Keeps D-83-12
  whole. _Why:_ the folder makes it a second spelling of the raw Auth.js import, which a
  path-only update would have let through.
- **D-115-10 · `eslint.config.mjs` is unchanged; `src/auth/index.ts` and `test/*.ts` are
  now linted with type information.** _Why:_ the config-file block that turns it off
  matches root files only, so they left it by moving; they pass, and exempting `test/**`
  would loosen lint for nothing. _Research:_ R-79.
- **D-115-11 · Every proposed `lib` placement is kept; none makes an import cycle.**
  `lib/session/sheet-motion.ts` (the Sheet's spring physics) and `lib/history/dates.ts`
  (the app-wide date format) are weak fits, left to the owner below. _Why:_ no proposed
  folder fits them better, and a new one was outside the brief.
- **D-115-12 · Older task records keep the paths they were written with.** README,
  `ARCHITECTURE.md` and `CLAUDE.md` carry the new ones. _Why:_ a record says what was
  true when it was decided.

## Relies on

D-04-1 (projects by suffix, so folders need no Vitest change), D-04-2, D-04-3, D-13-4,
D-13-5, D-36-10, D-75-17, D-83-12, D-109-1, D-111-15.

## Open questions

- Should `sheet-motion.ts` (used only by `components/ui/sheet.tsx`) and `dates.ts` (used
  by member and sync screens too) move, e.g. to a `lib/ui/`? Relatedly, `lib/session/`
  holds both sign-in state (`account-state`, `sign-out`, `own-name`) and the outing
  session's actions (`sessions.ts`), two meanings D-111-39 keeps apart in comments.
