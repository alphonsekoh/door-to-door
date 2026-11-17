# #195 · A failure on the member page scrolls clear of the nav alone

- **Status:** In progress (branch `fix/195-member-page-scroll`)
- **Phase:** 7 - Hardening
- **Depends on:** #125, #164

## Task

The admin's member page brought a failed sign-in end into view with `scroll-clear-chrome`,
which keeps 80px for a docked Save the page never has, so it moved up to 80px further than
the nav hid the control. Apply D-164-7, as Account does, and prove it with an E2E that
fails with the old class. Client only: no contract or schema change. Left as a known
limit by #164.

## Decisions

- **D-195-1 · Both of the member page's failure blocks are `scroll-clear-nav`.** A row's
  Sign out and Sign out everywhere share `withFailure`, so one class covers both, and
  `member-detail.test.tsx` checks it on each. Applies D-164-7; refines D-125-22. _Why:_
  no Save docks on this page, so the 80px kept for one only moved the page further.
- **D-195-2 · Here `scroll-clear-nav`'s `--banner-bottom` term does work.** With no
  docked Save the install banner floats on the nav (D-111-46), and the margin now clears
  it too. Extends D-164-8, which found it adds nothing on Account. _Why:_ with the old
  class an 81px banner on an iPhone 13 covered Sign out by under 1px (0.48px measured).
- **D-195-3 · The E2E presses Sign out set exactly on what covers the foot of the
  screen,** the nav or the banner floating on it (`e2e/sign-ins.spec.ts`, "an end that
  fails"), and asserts it got there (`toBeCloseTo`). _Why:_ there the failure has the
  most to bring back, and the test fails loudly if the list stops running past the nav.
- **D-195-4 · The member is signed in on four phones, and the last row is pressed.**
  _Why:_ the list then runs past the nav at the default text on both phones, and the end
  of the page below it leaves room to over-scroll, which Account's spec got from the
  install banner (D-164-9).
- **D-195-5 · The DELETE is aborted, not refused, with the service worker blocked as in
  D-164-5.** The alert is "Could not sign out. Check your connection and try again."
  _Why:_ with no answer the message is fixed (D-125-22), where a refusal shows the
  server's; `page.route` does not see the worker's fetches on WebKit (R-138).
- **D-195-6 · At the default text and at 32px (D-111-24), bounded from both sides as
  D-164-6 and D-164-9 are.** The alert's top is on screen, Sign out ends at most 0.5px
  under what covers the foot, and the page moves at most 1px more than that hid it. On
  WebKit the test waits for the install banner, then two frames after the text size
  changes. _Why:_ an iPhone shows its install guide regardless, and whether it floats
  follows its size (D-111-46), so measured early the foot is the wrong one.
- **D-195-7 · Both scroll E2Es read Sign out's foot off its failure block,** after
  asserting Sign out is the block's last child (5e250ba). Refines D-164-6 and D-164-9:
  Account's spec changed too. _Why:_ Chromium holds a tapped button `:active` a moment,
  so `press` can still scale Sign out to 97% once it is enabled again. At 32px it read
  1.3px high, past the 1px bound, and the Pixel 5 run failed once in three (verifier).
  The block is what is scrolled into view and is never scaled, so its foot is Sign out's
  unscaled foot and the check is no weaker.
- **D-195-8 · Only the member page changes; no other screen has the mismatch.** Account
  is already `scroll-clear-nav` (D-164-7). Household history uses `scroll-clear-chrome`
  only at the door, where Save docks (D-160-17). The recording form appears only on the
  block screen, which docks Save. Sign-in has no margin on purpose (D-151-7), and sheets
  use `scroll-clear-sheet-actions` (D-136-3). _Why:_ the issue asked for the survey; each
  of these is right as it is.

### How existing decisions are handled

| Decision         | Effect                                                          | By      |
| ---------------- | --------------------------------------------------------------- | ------- |
| D-125-22         | Refined: the failure blocks are `scroll-clear-nav`              | D-195-1 |
| D-164-7          | Applied to the member page; #164's known limit fixed            | D-195-1 |
| D-164-8          | Extended: the banner term clears a floating banner on this page | D-195-2 |
| D-164-6, D-164-9 | Refined: Sign out's foot is read off its failure block          | D-195-7 |

## Evidence

- With `scroll-clear-chrome` put back the E2E fails on both phones: a Pixel 5 at the
  default text moved 155px where 79 was the limit, and both phones at 32px moved 378px
  where 299 was (builder, a6267ce).
- After D-195-7, Sign out held pressed before measuring fails the old reading in both
  specs on both phones at 32px, and the new one passes; with the old class both specs
  still fail on both phones (5e250ba).
- No research entries were needed.

## Known limits

- On an iPhone 13 at the default text the E2E barely tells the classes apart: the
  floating banner is 81px and `scroll-clear-chrome` keeps 80px, so with the old class
  Sign out ends 0.48px under the banner, inside the 0.5px allowance. On WebKit the 32px
  pass is the proof.
- The E2E measures only a row's Sign out. Sign out everywhere's block is checked only by
  its class in jsdom, which relies on both going through `withFailure`.

## Relies on

D-37-6, D-111-5, D-111-10, D-111-24, D-111-46, D-125-22, D-136-3, D-151-7, D-160-17,
D-164-5, D-164-6, D-164-7, D-164-8, D-164-9.

## Open questions

None.
