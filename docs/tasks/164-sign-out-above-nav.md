# #164 · Sign out above the nav after a failed sign-out

- **Status:** In progress (PR #178); the owner chose (b) on D-164-3 and D-164-4 on 2026-11-13 (D-164-7)
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
  (D-125-22).** The alert and Sign out are one ~~`scroll-clear-chrome`~~ block, brought
  into view together with `scrollIntoView({ block: "nearest" })`, instantly and before
  paint, as D-111-69 does after a save. The alert keeps `role="alert"` and focus is not
  moved, so D-90-9's return after "Sign out anyway" stands. _Why:_ one pattern for a
  failure told beside the control pressed; the member hears it and their thumb stays on
  Sign out. _Research:_ R-163. _Refined by D-164-7:_ the block is `scroll-clear-nav`.
- **D-164-2 · Only a failure appearing scrolls the page.** Not on opening Account, and
  not when a second try clears the alert. _Why:_ Account opens at its top, and on a
  second try Sign out is under the thumb that just pressed it.
- ~~**D-164-3 · `scroll-clear-chrome` is reused as it is, with the 80px it keeps for the
  docked Save bar (pending the owner).** No new utility or offset (D-111-5, D-111-10).
  _Why:_ a bottom margin is needed, since without one `nearest` counts a box under the
  fixed nav as in view (R-163), and this is the shared one. _Trade-off:_ Account's Save
  bar stays in its form (D-111-20), so it is never over Sign out, and the extra 80px only
  makes the page move further, or move when nothing was hidden. On an iPhone 13 at the
  default text it moves 110px for the 30px needed, leaving 80px above the nav. On a
  Pixel 5 with the install banner below Sign out it moves about 47px (the reviewer's
  estimate) where nothing was hidden.~~ Superseded by D-164-7 (owner, 2026-11-13).
- **D-164-4 · Account's layout is kept; where the alert and Sign out cannot both fit
  above the nav, the page scrolls itself (owner, 2026-11-13).** On an iPhone 13 at the
  default text they cannot (74px needed, 44px free), so the issue's "without scrolling"
  holds there only as "without the member scrolling". A Pixel 5 at the default text does
  not move. _Why:_ fitting them unmoved needs a design change, Sign out above the
  Email/Role card or a smaller card, which is the owner's call. _Reaffirmed by the
  owner:_ that redesign, option (c), was declined; the page moves only as far as Sign out
  is hidden (D-164-7).
- **D-164-5 · The E2E refuses the sign-out as the server does, with the service worker
  blocked.** In `e2e/account.spec.ts`, beside the other sign-out tests (D-37-6),
  `/api/auth/signout` answers D-125-20's `500` with `{url: "/sign-in?error=SignOutError"}`,
  `no-store` and `Clear-Site-Data: "cache"`, as the real route does (checked by the
  reviewer). _Why:_ on WebKit, `page.route` does not see what the worker fetches (R-138);
  the request-held test in the same file blocks it for the same reason.
- **D-164-6 · The E2E measures real boxes at the default text and at 32px (D-111-24).**
  The alert's top is on screen, Sign out's bottom is at or above the nav's top, and focus
  is not on the alert. On origin/main's layout it fails on both phone projects: iPhone 13
  at the default text (Sign out ends at 630, the nav starts at 600), Pixel 5 at 32px (905
  against 663). It also fails with only the margin removed (builder, confirmed by the
  verifier). _Why:_ jsdom lays nothing out, and either size alone misses one phone.
  _Extended by D-164-9:_ an upper bound on how far the page moves.
- **D-164-7 · Account clears the nav alone, with a new shared utility, `scroll-clear-nav`
  (owner, 2026-11-13).** Supersedes D-164-3. In `globals.css` beside
  `scroll-clear-chrome`, with the same top margin and no room for a docked Save, so the
  page moves only as far as Sign out is hidden, leaving it on the nav's top: about 30px
  on an iPhone 13 at the default text, none on a Pixel 5. _Why:_ Account's Save is never
  pinned over Sign out (D-111-20), and `scroll-clear-chrome`'s 80px for it moved the page
  110px for 30, and 47px on a Pixel 5 where nothing was hidden. Declined: (a) accepting
  that, and (c) a redesign so nothing moves. Shared, not a one-off offset (D-111-5).
  _Research:_ R-163.
- **D-164-8 · `scroll-clear-nav`'s bottom margin includes `--banner-bottom`, so it
  equals `pb-nav`'s padding.** `scroll-clear-chrome` leaves it out. _Why:_ that padding
  is the room the end of every page leaves, so the margin can always be met, and a banner
  floating above the nav is cleared too. On Account it adds nothing today: the install
  banner does not float while Account's Save is mounted (D-111-46).
- **D-164-9 · The E2E also bounds the move from above.** The page may move at most 1px
  more than the nav hid Sign out; Sign out is scrolled to before it is pressed, so the
  move is the failure's. The default-text pass shows the install banner below Sign out,
  which leaves room to over-scroll; `offerInstall` moved from `pwa.spec.ts` into
  `e2e/fixtures.ts` for it. With `scroll-clear-chrome` put back it fails on both phones
  (Pixel 5: 47 > 1; iPhone 13: 110 > 30.98). _Why:_ D-164-6's checks passed the 110px
  move, and without the banner nothing below Sign out leaves room to over-scroll.

## Known limits

- A second try clears the alert at once, so Sign out moves up under the thumb: 74px on a
  Pixel 5 and about 73px on an iPhone 13 at the default text, about 241px on an iPhone 13
  at 32px, and none on a Pixel 5 at 32px, where the page is at its end. It reads "Signing
  out…" and is disabled meanwhile. This was already so on main (verifier; figures with
  `scroll-clear-nav` from the reviewer).
- The member page's failed sign-in end (`src/components/admin/member-detail.tsx`) still
  scrolls with `scroll-clear-chrome`, though it docks no Save: on a row near the end of
  the list the page can move up to 80px further than needed, or where nothing was hidden.
  Ruling (b) covers Account only. Follow-up (no issue yet): switch it to
  `scroll-clear-nav`, with D-164-9's two-sided bound (reviewer).

## Owner checks (real iPhone; not claimed by the PR)

A failed sign-out is mostly an offline one, and Playwright's WebKit goes offline around
the worker (D-32-18). In Safari and the home-screen app, in airplane mode, at the default
and the largest text: Sign out, and "Sign out anyway" with a record waiting. Expect the
alert and Sign out in view above the nav without a jarring jump, VoiceOver reading the
alert with focus left where it was, and no second scroll on a second try.

## Relies on

D-32-18, D-37-6, D-83-14, D-90-8, D-90-9, D-111-5, D-111-10, D-111-20, D-111-24, D-111-46,
D-111-60, D-111-69, D-125-20, D-125-21, D-125-22.

## Open questions

None.
