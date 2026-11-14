# #181 · E2E flakes: "Signed out" after a reload, and Notes at the largest text

- **Status:** In progress, with #171 on one branch (`fix/171-181-e2e-flakes`). Part 1
  is fixed in the spec. Part 2 was not reproduced, so the issue stays open.
- **Phase:** 7 - Hardening
- **Depends on:** #125, #33

## Task

Two E2E tests failed once on PR #177 (CI run 43375997037) and passed on a rerun. The
first is `sign-ins.spec.ts:139` on mobile-chromium, where "Signed out" did not show
after a reload. The second is `large-text.spec.ts:369` on mobile-webkit, where Notes did
not show at the largest text. Find each cause and fix it, with no waits or retries.
Built with #171 in commit 071adad.

## Decisions

- **D-181-1 · Cause of `sign-ins:139`: the queue's owner check was answered after the
  admin ended the sign-in.** That check (D-33-1) asks `/api/auth/session`, which named
  nobody and cleared the cookie (D-125-4). The reload, with no cookie, went to
  `/sign-in?callbackUrl=…` (D-16-1), where "Signed out" never shows. _Why:_ that was
  CI's failure page. With the check held until after the end, the old spec failed 3 of
  3 on the same page (verifier). _Research:_ R-154.
- **D-181-2 · The spec accepts either landing, "Signed out" or the sign-in page.** In
  both, the record stays unsent, and it sends once after signing in. _Why:_ the app
  promises that the phone is signed out (D-125-4, D-16-1), not which screen says so.
  _Rejected:_ waiting for the queue's first send before the end, which is an added wait.
  Clearing the cookie on purpose, which picks one path instead of allowing both.
- **D-181-3 · "Sign in again" is pressed only when "Signed out" shows**
  (`sign-ins.spec.ts`, `if (await toldSignedOut.isVisible())`). _Trade-off, accepted:_
  no other E2E spec presses that button. So on a run where the queue clears the cookie
  first, the spec misses a broken Sign in again, such as a wrong destination or a
  sign-out that hangs. Vitest still asserts its destination
  (`auth-failure-screen.test.tsx`), and `:66` still asserts "Signed out" after a reload.
  The verifier saw both branches run: 4 of 4 through "Signed out" with nothing held, and
  3 of 3 through sign-in with the check held late. _Not taken_ (reviewer, optional):
  aborting `**/api/auth/session` on the context from before the end until "Signed out"
  shows. That forces the usual path with no wait, because an unanswered check is no
  signal (D-33-1).
- **D-181-4 · The queue is read once the URL leaves `/sign-in`, as `signInThroughForm`
  does.** _Why:_ signing in loads the next page in full. Read as the sign-in page was
  left, the queue threw "Execution context was destroyed" (3 of the builder's 100 runs).
- **D-181-5 · `large-text:369` is left unchanged and open.** It did not reproduce: 100 of
  100 runs (builder) and 40 of 40 beside a coverage run (verifier), on macOS WebKit only.
  It was not tried on CI's Linux WebKit, which the issue's criterion also names. The PR
  must say `Refs #181`, with no closing keyword. _Why:_ with no cause found, any change
  would be a guess or a wait.

## Known limits

- Part 2 of #181 is still open. The next step is `--repeat-each=40` on CI's Linux
  WebKit.
- A member whose sign-in an admin ends may land on plain `/sign-in`, with no "Signed
  out" and no signed-out note. This happens when the queue's check is answered first. The
  record is kept, and it sends after signing in. This has been true since #125. D-125's
  Known limits now says so (Open questions).
- Two more problems were found outside #181's text and are not touched here. Each needs
  an issue or a comment on #181:
  - CI run 43375997037 also failed `large-text.spec.ts:613` on WebKit ("OK brings the
    note back with its top edge in view"), and the artifact has no trace for it. That
    test is marked `test.fail` on WebKit for #136 (D-119-33), so that failure may mean
    its body passed.
  - On CI's Linux WebKit at 32px, "Record a visit" wraps onto two lines before the
    session loads. D-111-54 was meant to prevent that.

### How existing decisions are handled

| Decision | Effect                                                                     | By      |
| -------- | -------------------------------------------------------------------------- | ------- |
| D-125-4  | Kept: the session endpoint clears an ended sign-in's cookie                | D-181-1 |
| D-125    | Known limit amended: an ended sign-in can reach plain `/sign-in`           | D-181-1 |
| D-85-6   | Kept: when "Signed out" shows, Sign in again goes to the signed-out note   | D-181-3 |
| D-125-12 | Kept: `sign-ins.spec` still proves an unsent record sends after signing in | D-181-2 |
| D-125-18 | Followed: read after signing in through the form, as `signInThroughForm`   | D-181-4 |
| D-37-4   | Kept: no waits or retries                                                  | D-181-5 |

## Relies on

D-16-1, D-33-1, D-37-4, D-85-6, D-119-33, D-125-4, D-125-12, D-125-18.

## Open questions

- **The signed-out landing.** If the queue's check is answered first, a member whose
  sign-in was ended reaches the sign-in page without being told why. Is that acceptable,
  or should that path show the signed-out note too?
