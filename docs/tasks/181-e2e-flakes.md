# #181 · E2E flakes: "Signed out" after a reload, and Notes at the largest text

- **Status:** In progress. Part 1 is fixed in the spec (PR #185, with #171). Part 2's
  cause is found and fixed in the app on `fix/181-large-text-notes` (D-181-6 to
  D-181-8), but `:376` has not run on CI's Linux WebKit. The PR says `Refs #181`, and
  closing #181 is the owner's call.
- **Phase:** 7 - Hardening
- **Depends on:** #125, #33, #111

## Task

Two E2E tests failed once on PR #177 (CI run 43375997037) and passed on a rerun. The
first is `sign-ins.spec.ts:139` on mobile-chromium, where "Signed out" did not show
after a reload. The second is `large-text.spec.ts:369` (now `:376`) on mobile-webkit,
where Notes did not show at the largest text. Find each cause and fix it, with no waits
or retries. Part 1 was built with #171 in commit 071adad, part 2 in 4e8063c.

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
  would be a guess or a wait. _Refined by D-181-7:_ a cause was then found in CI's trace
  and fixed in the app. `:376` is still unchanged, and #181 stays open for the Linux run.
- **D-181-6 · Until the session answers, the block screen's title is a stand-in held to
  one line.** `PageHeader` takes `standIn`, which sets the title `truncate` in place of
  `text-balance break-words`. The block screen passes it while the session is unknown
  (`active === null`), and so does its loading screen. Once the session has answered, a
  generic title (a block outside the session) is the screen's own and wraps as before.
  The heading's accessible name stays whole. Refines D-111-25, D-111-35 and D-111-54.
  Cutting it under 12ch is an exception to D-111-37 that waits on the owner (Open
  questions). _Why:_ at the 32px root, "Record a visit" set on two lines wherever it was
  wider than the title column. It gave a line back as "Blk 123" arrived, and the form
  moved 48px up under a press (D-181-7). _Not taken:_ shorter copy, which is the owner's
  call. _Research:_ R-192.
- **D-181-7 · Cause of `large-text:369`: the session answered during the press on Add
  details, and the button moved out from under it.** In CI's trace the press began with
  the title on two lines and the page at scrollTop 664. The session answered about 1ms
  in and was drawn before the release, so the header went from 136 to 88px. If that
  happens before the scroll is clamped, the press point ends about 4px under the
  button's foot. Playwright checks its hit target only at the first pointer event, so
  the release and the click landed off the button with no error, and the details never
  opened. macOS WebKit clamps the scroll in the same layout, which is why `:376` never
  failed here. _Why:_ CI's failure screenshot showed Add details unopened with Save
  and next live (D-136's known limit). The final scrollTop of 634 fits only a release
  before the clamp. With the cause back, a press on All units across the session's
  answer was lost on both engines (verifier). _Research:_ R-190, R-191.
- **D-181-8 · `:376` stays as it is, and a new check guards the cause.** "The recording
  form holds still as the block's name arrives" (`large-text.spec.ts:845`) holds
  `/api/sessions/active` on a promise the test releases, at 320×568 and 32px. It asserts
  that the unit field does not move as "Blk 123" arrives. The service worker is blocked
  there, since `page.route` cannot see its requests. Extends D-111-65. _Why:_ `:376`
  passes on macOS with the cause back (10 of 10, verifier), so it cannot guard it. At
  320px the stand-in wraps in every engine's font, as it did at 390px in CI's. Without
  the fix the unit field moves from 386 to 338 on both engines. _Research:_ R-192.

## Known limits

- **#181 stays open until `:376` passes `--repeat-each=40` on CI's Linux WebKit.**
  Actions cannot run (spending limit) and Linux WebKit cannot run here (no Docker). On
  macOS, `:376` passed 100 of 100 (builder) and 40 of 40 beside a coverage run
  (verifier) with the fix. It also passes without the fix, so no local run of it proves
  the Linux miss is gone. The proof is the header's fixed height and `:845`.
- **The stand-in can be cut short.** At 32px it reads "Recor…" in DejaVu Sans on a
  320px screen, and "Record a…" in the system font at 320px or in DejaVu at 390px. It
  stays cut until the session answers, and for good when no session runs (404) or the
  request fails. The sweep misses this because `expectFits` keeps polling until
  "Blk 123" arrives (Open questions).
- **A block name too wide for one line still moves the form as it arrives**, now the
  other way. `openapi.yaml` allows names of 16 characters. At 32px on a 320px screen,
  "Blk 268C" takes about 166px of bold DejaVu in a column about 160px wide (reviewer's
  estimate, not measured). Before this change the stand-in was two lines there too, so
  nothing moved. Now the form drops about 48px as the name arrives.
- **A later answer still grows the page.** In CI's trace it ended about 18px taller,
  most likely from the units, as "All units (0)" became "All units (38)" (R-190). That
  is content landing, as in D-156's known limits, and nothing holds it.
- A member whose sign-in an admin ends may land on plain `/sign-in`, with no "Signed
  out" and no signed-out note. This happens when the queue's check is answered first. The
  record is kept, and it sends after signing in. This has been true since #125. D-125's
  Known limits now says so (Open questions).
- Found outside #181's text:
  - ~~CI run 43375997037 also failed `large-text.spec.ts:613` on WebKit, so that failure
    may mean its body passed.~~ Corrected by D-136-13: `:613` had outcome `expected`,
    failing as its `test.fail` declared, so it never failed CI (R-183). It is now
    `:640`, with no mark.
  - ~~On CI's Linux WebKit at 32px, "Record a visit" wraps onto two lines before the
    session loads, against D-111-54.~~ Resolved by D-181-6. This is #196's item 1, and
    the PR says `Refs #196`.
  - In a follow-up session at 32px, the unit field drops 170px as the session answers
    and ends half under the docked Save. The "Follow-up session" notice arrives with no
    room kept for it. This is D-181-7's mechanism with a bigger shift, older than #181
    and not in #196. It needs an issue (verifier).
  - A block tapped before its route's prefetch lands can show an empty main instead of
    "Loading the block…" (Chromium, 2 of 11 probe runs; verifier).

### How existing decisions are handled

| Decision | Effect                                                                     | By      |
| -------- | -------------------------------------------------------------------------- | ------- |
| D-125-4  | Kept: the session endpoint clears an ended sign-in's cookie                | D-181-1 |
| D-125    | Known limit amended: an ended sign-in can reach plain `/sign-in`           | D-181-1 |
| D-85-6   | Kept: when "Signed out" shows, Sign in again goes to the signed-out note   | D-181-3 |
| D-125-12 | Kept: `sign-ins.spec` still proves an unsent record sends after signing in | D-181-2 |
| D-125-18 | Followed: read after signing in through the form, as `signInThroughForm`   | D-181-4 |
| D-37-4   | Kept: no waits or retries; a held answer is released by the test           | D-181-8 |
| D-181-5  | Refined: a cause found and fixed; `:376` unchanged, #181 open              | D-181-7 |
| D-111-25 | Refined: the stand-in title is one line, cut if need be (owner to confirm) | D-181-6 |
| D-111-35 | Refined: the stand-in does not break a long word                           | D-181-6 |
| D-111-37 | Exception pending the owner: the stand-in cut under 12ch                   | D-181-6 |
| D-111-54 | Its reason now holds in CI's font too: the stand-in no longer wraps        | D-181-6 |
| D-111-65 | Extended: the form holds still as the block's name arrives                 | D-181-8 |
| D-136-13 | Applied: the `:613` reading corrected above                                | —       |

## Relies on

D-16-1, D-33-1, D-37-4, D-85-6, D-111-25, D-111-35, D-111-37, D-111-54, D-111-65,
D-111-66, D-119-33, D-125-4, D-125-12, D-125-18, D-136-13.

## Open questions

- **The signed-out landing.** If the queue's check is answered first, a member whose
  sign-in was ended reaches the sign-in page without being told why. Is that acceptable,
  or should that path show the signed-out note too?
- **D-181-6's cut stand-in (reviewer).** D-111-25 says "Title rows and sheet headers
  wrap", D-111-35 says "Page titles break a long word", and D-111-37 counts "a column
  under 12ch cut short" as a fault. The stand-in now reads "Recor…" at 32px on a 320px
  screen in DejaVu Sans, and stays cut while no session answers. Accept it as an
  exception to the 12ch rule for a title that stands in for one not yet known, or
  reject it? Shorter copy is the other way out. Not blocking: every alternative found
  costs more.
