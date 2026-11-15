# #187 · Vitest 5, ESLint 10, jsdom 31 and @types/node 24 (Dependabot #183)

- **Status:** Done (PR #198)
- **Phase:** 7 - Hardening
- **Depends on:** #166, #124

## Task

Dependabot #183 bumps five dev dependencies: vitest and @vitest/coverage-v8 4.1.11 to
5.1.0, eslint 9.39.5 to 10.14.0, jsdom 30.0.1 to 31.0.0 and @types/node 20.19.43 to
24.19.2. Its CI failed four tests in `src/proxy.test.ts`: `NextAuth.mock.calls[0]` was
empty. Take the bumps here, find the cause, and keep every test and threshold. Built in
commits 0afd093 (dependencies) and a8f26ac (test).

## Decisions

- **D-187-1 · Vitest 5's `clearMocks: true` default is kept.** `vitest.config.mts` does
  not set it back to `false`. The test files that also call `vi.clearAllMocks()`
  themselves are left as they are. _Why:_ no mock then carries calls from one test into
  the next, and only `src/proxy.test.ts` failed under it. _Rejected:_ setting it to
  `false`, the migration guide's way back to Vitest 4. _Research:_ R-185.
- **D-187-2 · A test about what a module did as it loaded reads the mock before any test
  runs.** `src/proxy.test.ts` keeps the factory `NextAuth` got at import, as it already
  kept `getConfig`'s call count, and fails with a plain message if there was none.
  `src/auth/index.test.ts` already imports inside each test after `vi.resetModules()`.
  Every assertion stays: no adapter (D-16-1), a lazy factory (D-75-9), the secret and
  `trustHost` from the loaded config, and `useSecureCookies` from `auth.secureCookies`
  (D-122-12). _Why:_ Vitest 5 clears calls made at a module's top level before the first
  test. The fix also holds on Vitest 4. _Research:_ R-185.
- **D-187-3 · #183's `package.json` and `package-lock.json` are taken as they are, except
  `"dev"`, which keeps main's `next dev -H 127.0.0.1` (D-124-10).** The lockfile is
  byte-identical to #183's head (911ac28). No production package changes version;
  minimatch, brace-expansion and balanced-match only move to the top of `node_modules`.
  _Why:_ #183 branched before #179. With the same updates on main, Dependabot can close
  #183.
- **D-187-4 · `vitest.config.mts` and `eslint.config.mjs` are unchanged, and so is every
  coverage threshold.** Vitest 5's other breaking changes need nothing here, and nor do
  ESLint 10's, jsdom 31's or `@types/node` 24's. Coverage still lists every source file
  but the excluded ones, a thin run still fails the per-glob thresholds, and lint,
  typecheck and every component test pass unchanged. _Why:_ each migration guide was
  read against the repo and the result measured. _Research:_ R-186, R-187, R-189.
- **D-187-5 · Known risk, accepted: `npm ls` marks ESLint 10 invalid.** eslint-config-next
  16.4.5 brings eslint-plugin-react, -import and -jsx-a11y, whose `eslint` peer ranges
  stop at 9. Their rules still report under 10.14.0 (reviewer, from stdin): react/jsx-key,
  react/display-name, import/no-anonymous-default-export, jsx-a11y/alt-text,
  @next/next/no-img-element, react-hooks/rules-of-hooks, and the repo's own `yaml`
  import ban, type-over-interface, no-explicit-any and no-floating-promises. _Why:_
  `npm ci` installs it, and the rules lint relies on still fire. _Research:_ R-187.
- **D-187-6 · Development now needs Node 24.15+ or 22.22.2+; README said 20+.** jsdom 31's
  engines are the tightest of the five. CI's `NODE_VERSION` 24 and the Dockerfile's
  pinned `node:24-alpine` (24.22.3) meet it. `@types/node` 24 now matches that runtime,
  as D-166-10 planned. _Why:_ Vitest 5 and jsdom 31 do not support Node 20.
  _Research:_ R-188.

## Evidence

- **Gates, local only:** GitHub Actions cannot run (the account's spending limit), so no
  CI has run on this branch. Lint, typecheck, format check, `npm test` (3735),
  `test:coverage` on `door_to_door_test_187` (4868, thresholds met), `npm run build`, and
  the Playwright suite on mobile-chromium (93) all pass (builder; tests and coverage
  rerun by the reviewer).
- **The proxy test bites:** an adapter in the proxy's config fails 1 test; a wrong secret,
  `trustHost` or `useSecureCookies` fails 2; an eager config fails 5 (builder, reviewer).

## Known limits

- WebKit E2E was not run locally; a tooling bump does not reach the browser.

## Relies on

D-04-1, D-04-2, D-04-3, D-16-1, D-75-9, D-122-12, D-124-10, D-151-11 (its reason still
holds, R-178), D-166-10, D-118-7.

## Owner checks

- Once Actions runs again, let CI pass on this branch before merging: D-166-10 lands the
  group only when it passes.
- Check that #183 closes when this merges.

## Open questions

None.
