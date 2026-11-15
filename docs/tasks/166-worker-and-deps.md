# #166 · Worker state flake, and Dependabot #174 and #175

- **Status:** Done (PR #182). Dependabot #175 merged after it; Dependabot closed #174.
- **Phase:** 7 - Hardening
- **Depends on:** #32, #33, #77, #118, #131

## Task

`pwa.spec`'s "activates, and takes control of the next load" read the worker's state
once and got `"activating"` on WebKit in CI. The same branch takes two Dependabot
failures: #175's minor and patch bumps failed the offline page's retry test on Chromium,
and #174's majors could not install. Only `e2e/pwa.spec.ts` and `.github/dependabot.yml`
change; no app code.

## Decisions

- **D-166-1 · The activation test polls the worker's state until `"activated"`, on both
  phones.** The cause is not `clients.claim()`, as the issue guessed: it is off (D-32-6).
  The page can be in the worker's charge while its copy of the worker still reads
  `"activating"`. _Why:_ one read raced that update once in WebKit CI, and the poll
  passes whenever the single read did. _Research:_ R-166.
- **D-166-2 · With activation blocked, the test fails at `controlled()`'s reload, not at
  the poll.** A controlled navigation waits for activation to finish, so the poll cannot
  be reached while activation is stuck. The old single read could not be reached either,
  so no failure is missed, and no app code reads the worker's state. _Why:_ meets the
  criterion "still fails when the worker never activates" on both phones. _Trade-off:_
  that failure names the reload, not the state. _Research:_ R-166.
- **D-166-3 · #175's failure comes from Playwright 1.64, not from Next, React or the
  app.** 1.64.1 alone, on main's Next and React, fails the same way. In 1.64 a document
  loaded offline reads `navigator.onLine` false and gets `online` when the context comes
  back online. So the offline page's own reload (D-33-22) left before the tap on Try
  again. _Why:_ a phone does the same, so the app is right and the test changes.
  _Research:_ R-164.
- **D-166-4 · The retry test fails every request with a context route
  (`route.abort("internetdisconnected")`) instead of going offline.** It asserts that
  `navigator.onLine` stays true: the one-bar case, where no `online` comes and Try again
  is the only way back. _Why:_ on 1.62 and 1.64 alike, nothing races the tap. A wait or a
  retry would only hide the race. The worker's own fallback still answers on Chromium
  (R-138). _Research:_ R-164, R-165.
- **D-166-5 · WebKit still skips the retry test. Extends D-32-18:** Playwright's WebKit
  fails a routed request before the worker too, as it does offline. The skip reason now
  says so. _Why:_ observed with the skip lifted. _Research:_ R-165, R-22.
- **D-166-6 · The cold-offline and follow-up shell tests keep their hand-fired
  `online`. D-77-16's reason now holds for Playwright 1.62 only.** On 1.64 the native
  event comes too, and the second changes nothing: each visit is still stored once.
  _Why:_ main runs 1.62 until #175 lands, and both must test the wake. _Research:_ R-164.
- **D-166-7 · Scope cut: D-33-22's automatic reload on `online` still has no E2E test.**
  _Why:_ Playwright 1.62 never fires the event. A test becomes possible once 1.64 is on
  main.
- **D-166-8 · The branch keeps main's `package.json` and `package-lock.json`.** #175
  stays Dependabot's own PR and lands after a rebase. _Why:_ the fix passes on both
  version sets (the whole suite passed on #175's), so it needs nothing from #175.
- **D-166-9 · Dependabot ignores TypeScript majors** until typescript-eslint supports 7.
  _Why:_ #174 cannot install. typescript-eslint 8.72.1 takes TypeScript `>=4.8.4 <6.1.0`,
  so `npm ci` refuses 7.0.2 with `ERESOLVE`. _Trade-off:_ it also holds back 6.0, which
  typescript-eslint accepts. Extends D-118-7. _Research:_ R-167, R-168.
- **D-166-10 · Dependabot holds `@types/node` at 24 and below** (`versions: [">=25"]`).
  The bound moves with the runtime, as D-131-5's `node` image major does. _Why:_ the app
  runs on Node 24 (the Dockerfile's `node:24-alpine`, CI's `NODE_VERSION`). #174 offered
  26, whose types admit APIs Node 24 lacks. Not bumped here: 20 to 24 comes in the next
  npm-major group PR, with eslint 10, vitest 5 and jsdom 31. It lands only when that
  whole group passes. _Research:_ R-168.
- **D-166-11 · These two ignores hold back security updates too. Extends D-118-7.** The
  file's "Security updates are not held back" is true of the cooldown only. _Why:_
  acceptable for a dev-only compiler and a types-only package. _Research:_ R-168, R-95.

## Relies on

D-32-6, D-32-14, D-32-15, D-32-18 (extended), D-33-22, D-37-6, D-77-16 (reason amended),
D-118-7 (extended), D-131-5.

## Known limits

- `e2e/pwa.spec.ts:383` (follow-up shell test) still says no `online` fires for a
  document loaded offline. That is true on 1.62 only (verifier). Code, so flagged here,
  not fixed.
- `record-visit.spec.ts:587` stalls on local macOS WebKit under load, also on main's own
  `e2e/`. It passes alone and in CI. If CI ever shows it, it gets its own issue.

## Follow-ups

- Once #175 is rebased onto this and merged: an E2E for D-33-22's reload (D-166-7).
- Lift D-166-9 when typescript-eslint takes TypeScript 7.

## Owner checks

- After this merges, rebase #175. Its CI should pass unchanged (D-166-8).
- The retry test's route on CI's Linux Chromium shows only on this branch's one push.

## Open questions

None.
