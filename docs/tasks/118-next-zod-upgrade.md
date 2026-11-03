# #118 · Upgrade Next.js to 16.4.3 and move zod off 4.6.5

- **Status:** In progress (branch `chore/118-next-zod-upgrade`, not yet pushed)
- **Phase:** 7 - Hardening
- **Depends on:** #12, #32, #74

## Task

`npm audit --omit=dev` reported a critical advisory on `next` 16.3.3 and high ones on
`zod` 4.6.5, `sharp` and `source-map-js`; the zod one is reachable through `withContract`.
Upgrade, switch off the unused image optimizer, bound what zod still parses item by item,
and add Dependabot.

## Decisions

- **D-118-1 · `next` and `eslint-config-next` go to 16.4.3, still exact pins.** _Why:_
  every Next advisory on 16.3.3 is fixed by 16.4.1, and 16.4.3 was the newest 16.x patch
  when the branch was cut. 16.4.4 came out hours later and is left for Dependabot to
  offer (D-118-7). _Research:_ R-94.
- **D-118-2 · Transitive fixes come from the lockfile, not from overrides.** `sharp`
  0.35.5 arrives as 16.4.3's optional dependency; `source-map-js` 1.2.2 comes from
  `npm update` within the existing ranges. _Why:_ an override is only needed where a
  package's own pin blocks the fix, and only zod has one (D-118-3).
- **D-118-3 · zod goes to `^4.6.7`, with `"overrides": { "zod": "$zod" }`,** not the
  issue's literal `"4.6.6"`. _Why:_ `@serwist/build` and `@serwist/turbopack` 9.5.13 pin
  zod to exactly 4.6.5, so only an override replaces their copy. `$zod` follows the
  root's range, whereas a literal override of a direct dependency fails `EOVERRIDE`
  once the root range changes. _Trade-off:_ Serwist runs on a zod it did not pin. That
  happens only at `next build`, where the build and the PWA E2E check it.
  _Research:_ R-91, R-92.
- **D-118-4 · The image optimizer is off (`images: { unoptimized: true }`), so
  `/_next/image` answers `404`.** An E2E in `e2e/pwa.spec.ts` checks the 404, and that
  the icon it would resize is still served. _Why:_ nothing uses `next/image`, and the
  optimizer is where the SSRF and the SVG remote-code-execution advisories were. Only a
  production build shows what the endpoint does. _Research:_ R-93, R-94.
- **D-118-5 · `CreateSessionRequest.blockIds` takes at most 50 items**, the same as
  `AttachBlocksRequest`. Apart from `memberIds` (D-118-6), every request array in
  `openapi.yaml` now has a `maxItems`. _Why:_ zod 4.6.6 stops early on an oversized
  array only when the array has a max. Without one, every bad element is its own issue,
  and `withContract` parses the body before the handler checks the role, so any member
  could send millions of ids. No screen sends `blockIds` when it creates a session.
  _Relies on:_ D-12-1. _Research:_ R-91.
- **D-118-6 · The cap stops at `CreateSessionRequest.blockIds` (D-118-5);
  `CreateTeamRequest.memberIds` stays uncapped (owner, 2026-11-03).** Reaffirms D-74-15.
  _Why:_ the owner chose to keep team creation unlimited. _Trade-off:_
  GHSA-mrhx-c7xc-m3w5 stays reachable: any signed-in member can `POST /teams` with a
  huge `memberIds`, and `withContract` builds one issue per bad item before the handler
  runs. The remaining mitigation is a request body size limit, tracked in #126, which
  bounds the list without capping team size; #126's own proposal of a `maxItems` on
  `memberIds` would contradict D-74-15. _Research:_ R-91. _Narrowed from:_ ~~Proposed:
  `CreateTeamRequest.memberIds` takes at most 50 items. It bounds a single request, not
  the size of a team, because `POST /teams/{id}/members` still adds people one at a
  time. Why: the same memory exhaustion as D-118-5, reachable by any member. Conflicts
  with D-74-15.~~ The cap went in with `fc0859c` and came off in `e2dbb0c`.
- **D-118-7 · Dependabot runs weekly and grouped (`.github/dependabot.yml`).** npm has
  three groups: security, minor-and-patch, major. GitHub Actions has one. Version
  updates wait out a 7-day cooldown. PRs get a `chore` prefix and the existing
  `type:chore` and `area:setup`/`area:ci` labels. _Why:_ each PR runs the full CI,
  E2E included, and Actions minutes are scarce. Majors stay apart so that one breaking
  bump cannot hold back the routine ones. The cooldown gives a hijacked publish time to
  be pulled, and it does not delay security updates. _Research:_ R-95.
- **D-118-8 · `next dev` 16.4.3's rewrite of AGENTS.md's generated block (its heading
  `#` became `##`) is committed.** _Why:_ D-02-3. Reverting it only recreates an
  uncommitted change.
- **D-118-9 · Scope cut: the advisories that remain are left.** For production these
  are 4 moderates: `glob` and `minimatch` under `@serwist/build`, with no fix available.
  They run only at `next build`, because Serwist's route is static. The dev-only tree
  (7 high, 27 moderate in a full `npm audit`, mostly the `@hey-api` codegen chain,
  `vite` and `undici`) is left to D-118-7's grouped updates. _Why:_ the issue's bar is a
  critical or high advisory reachable at runtime, and none of these reach the server or
  a browser. _Research:_ R-92, R-94.

## Relies on

D-02-3, D-06-1, D-10-1, D-12-1, D-21-7, D-32-2, D-74-15 (reaffirmed, D-118-6).

## Open questions

- **Owner action, not in the PR:** turn on Dependabot alerts and Dependabot security
  updates in the repository settings. This is one of the issue's acceptance criteria.
  D-118-7's `npm-security` group does nothing until security updates are on.
