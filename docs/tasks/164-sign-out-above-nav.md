# #164 · Sign out above the nav after a failed sign-out

- **Status:** In progress (branch `fix/164-sign-out-above-nav`, no PR yet); owner question open
- **Phase:** 7 - Hardening
- **Depends on:** #111, #125, #129

## Task

Account says "Could not sign out" just above Sign out, at the end of the page. On an
iPhone 13 Sign out had 44px clear of the bottom nav, so the 74px alert pushed it 30px
under the nav; at the largest text it went below the screen on both phones, and nothing
brought it back. D-125-20 made a failed sign-out more common. Seen by the #129 verifier on
PR #161. Client only: no contract or schema change.

## Decisions

- **D-164-1 · Account's failed sign-out is shown and scrolled as the member's page does
  (D-125-22).** The alert and Sign out are one `scroll-clear-chrome` block, brought into
  view together with `scrollIntoView({ block: "nearest" })`, instantly and before paint,
  as D-111-69 does after a save. The alert keeps `role="alert"` and focus is not moved,
  so D-90-9's return after "Sign out anyway" stands. _Why:_ one pattern for a failure
  told beside the control pressed; the member hears it and their thumb stays on Sign out.
  _Research:_ R-161.
- **D-164-2 · Only a failure appearing scrolls the page.** Not on opening Account, and
  not when a second try clears the alert. _Why:_ Account opens at its top, and on a
  second try Sign out is under the thumb that just pressed it.
- **D-164-3 · `scroll-clear-chrome` is reused as it is, with the 80px it keeps for the
  docked Save bar (pending the owner).** No new utility or offset (D-111-5, D-111-10).
  _Why:_ a bottom margin is needed, since without one `nearest` counts a box under the
  fixed nav as in view (R-161), and this is the shared one. _Trade-off:_ Account's Save
  bar stays in its form (D-111-20), so it is never over Sign out, and the extra 80px only
  makes the page move further, or move when nothing was hidden. On an iPhone 13 at the
  default text it moves 110px for the 30px needed, leaving 80px above the nav. On a
  Pixel 5 with the install banner below Sign out it moves about 47px (the reviewer's
  estimate) where nothing was hidden.
- **D-164-4 · Account's layout is kept; where the alert and Sign out cannot both fit
  above the nav, the page scrolls itself (pending the owner).** On an iPhone 13 at the
  default text they cannot (74px needed, 44px free), so the issue's "without scrolling"
  holds there only as "without the member scrolling". A Pixel 5 at the default text does
  not move. _Why:_ fitting them unmoved needs a design change, Sign out above the
  Email/Role card or a smaller card, which is the owner's call.
- **D-164-5 · The E2E refuses the sign-out as the server does, with the service worker
  blocked.** In `e2e/account.spec.ts`, beside the other sign-out tests (D-37-6),
  `/api/auth/signout` answers D-125-20's `500` `SignOutError`. _Why:_ on WebKit,
  `page.route` does not see what the worker fetches (R-138); the request-held test in the
  same file blocks it for the same reason.
- **D-164-6 · The E2E measures real boxes at the default text and at 32px (D-111-24).**
  The alert's top is on screen, Sign out's bottom is at or above the nav's top, and focus
  is not on the alert. On origin/main's layout it fails on both phone projects: iPhone 13
  at the default text (Sign out ends at 630, the nav starts at 600), Pixel 5 at 32px (905
  against 663). It also fails with only the margin removed (builder, confirmed by the
  verifier). _Why:_ jsdom lays nothing out, and either size alone misses one phone.

## Known limits

- A second try clears the alert at once, so Sign out moves up under the thumb: 74px on a
  Pixel 5, 26px on an iPhone 13, 242px there at 32px. It reads "Signing out…" and is
  disabled meanwhile. This was already so on main (verifier).
- Where the page ends before the margin is met, Sign out sits flush on the nav, fully
  tappable: a Pixel 5 at 32px, and a home-screen app on a 664px-tall screen (simulated).

## Owner checks (real iPhone; not claimed by the PR)

A failed sign-out is mostly an offline one, and Playwright's WebKit goes offline around
the worker (D-32-18). In Safari and the home-screen app, in airplane mode, at the default
and the largest text: Sign out, and "Sign out anyway" with a record waiting. Expect the
alert and Sign out in view above the nav without a jarring jump, VoiceOver reading the
alert with focus left where it was, and no second scroll on a second try.

## Relies on

D-32-18, D-37-6, D-83-14, D-90-8, D-90-9, D-111-5, D-111-10, D-111-20, D-111-24, D-111-60,
D-111-69, D-125-20, D-125-21, D-125-22.

## Open questions

- **Should the page move after a failed sign-out as it now does (D-164-3, D-164-4)?**
  Raised by the reviewer and the verifier; no blocker either way. Sign out is no longer
  hidden on either phone at any size, but on an iPhone 13 at the default text the page
  moves itself 110px, and it can move where nothing was hidden. Options:
  - (a) accept it as built;
  - (b) a margin that clears the nav but not a Save bar, a new shared utility in
    `globals.css`, so the page moves only what is needed (30px there, flush on the nav);
  - (c) change the screen, Sign out above the Email/Role card or a smaller card, so
    that nothing need move at the default text.

  (b) and (c) are changes on this branch before it is pushed.
