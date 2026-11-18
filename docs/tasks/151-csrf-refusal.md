# #151 · A refused CSRF check is not a wrong password

- **Status:** Done (PR #184)
- **Phase:** 7 - Hardening
- **Depends on:** #15, #120, #122, #128

## Task

When Auth.js refused a password sign-in for its CSRF check (`MissingCSRF`), the form said
"Email or password is incorrect.", so a member with a stale tab kept retyping a correct
password. Found during #122. The owner ruled on 2026-11-13: resend once, silently, and
only then say the page expired. Client only: no server, contract, schema or
authorization code changed.

## Decisions

- **D-151-1 · On `MissingCSRF` alone, the email form sends the sign-in once more,
  silently (owner, 2026-11-13).** `signInWithPassword`
  (`src/lib/session/password-sign-in.ts`) matches the exact type `"MissingCSRF"` and
  makes at most two calls, with no recursion, so it cannot loop. Every other type,
  `CredentialsSignin`, `Configuration` and `AccessDenied` included, ends after one call.
  The form stays on "Signing in…" with no message until the second answer. _Why:_
  `signIn` fetches a new token on every call, for whatever cookie the phone holds by
  then, so a cookie swapped since the first token (by another tab, or WebKit's worker
  check, R-40) passes, and the member is simply signed in. _Research:_ R-176.
- **D-151-2 · Only when the resend is refused for CSRF too does the form say "This page
  expired. Reload it and try again." (owner).** A resend refused on the credentials gets
  the generic message. _Why:_ a phone that keeps no CSRF cookie would be refused every
  time. A reload brings a new page and cookie. _Kept by the owner (2026-11-15):_ the
  same words in the installed app, which has no reload button (PR #184 asked).
- **D-151-3 · Every refusal about an account keeps D-15-1's one message (owner).** That
  covers a wrong password, an unknown, deactivated or Google-only email, and a spent
  budget (the ruling's "locked"). D-15-1 is kept, with its scope stated: it covers
  refusals about accounts. _Why:_ Auth.js checks the token before it reads the
  credentials, and the refusal is the same `200` whoever the email belongs to, so
  "expired" says nothing about accounts. Auth.js passes only client-safe types to the
  page. Any other error reads `Configuration`, which stays generic. _Research:_ R-176.
- **D-151-4 · A CSRF refusal charges no sign-in budget and writes no sign-in log line.
  A tap still charges at most one attempt.** Auth.js refuses before `authorize`, so
  `authorizeFromRawCredentials`, the only place `consume`, `refund` and `reset` run, is
  never reached. No per-email, per-client or app-wide budget changes (D-120-5,
  D-120-11). The only line is #128's `[auth][error] MissingCSRF`, under D-128-4's 60 s
  throttle: if both tries are refused within it, the second is counted as suppressed,
  not written. The route test pins it with real Auth.js and an over-long email whose own
  refusal line (D-120-1) never appears. _Why:_ the issue asked. A resend follows only a
  refusal that never reached the credentials, so it cannot double-charge a member.
  _Research:_ R-176.
- **D-151-5 · The password stays a function argument for the length of the submit.** It
  is sent only in the POST body, and the resend reuses the same arguments. No new state,
  ref, storage or URL holds it. _Why:_ a retry must not keep the password past the tap
  that sent it.
- **D-151-6 · Google's button is unchanged (scope cut).** A CSRF refusal of its POST
  still returns as `?error=MissingCSRF` and shows D-14-6's "Google sign-in didn't
  finish." _Why:_ it leaves the page by redirect, so the form has no answer to resend
  from. It does not share the password path.
- **D-151-7 · A refusal is scrolled into view as it is drawn.**
  `scrollIntoView({ block: "nearest" })` runs in a layout effect, before paint, and
  focus stays on Sign in. As in D-164-2, only a refusal appearing scrolls: not Google's
  `?error=` message as the page opens, and not a second try clearing it. There is no
  scroll margin, neither `scroll-clear-chrome` nor `scroll-clear-nav`. Nothing is
  pinned over `/sign-in` (D-37-3, D-32-12). The message stays at the top of the form.
  _Why:_ there it was drawn above the screen once the member had scrolled down to Sign
  in. That happened on an iPhone 13 at 30 and 32px text, and on a short screen on both
  phones. It affected "This page expired" and, already on main, "Email or password is
  incorrect.". _Research:_ R-163. _Refined by D-208-3:_ in a browser, focus never stayed
  on Sign in for a refusal held past a frame (R-200). It now goes back to the button the
  press focused, only if it fell to the page, so after an iPhone tap it stays on the page.
- **D-151-8 · The E2E makes the server refuse for real.** It is in `e2e/auth.spec.ts`,
  not `sign-ins.spec.ts`, on both phone projects, with service workers blocked (R-138,
  as D-164-5). A `page.route` on `/api/auth/csrf` fetches the real answer. It then swaps
  the page's CSRF cookie for a genuine one the server issued to another visitor, and
  fulfils with the token alone, for the next _n_ token fetches. The tests cover three
  cases:
  - with one swap, the sign-in succeeds after two POSTs;
  - with every fetch swapped, the expired message shows after two POSTs, and the page
    stays on `/sign-in`;
  - with one swap and a wrong password, the generic message shows.

  _Why:_ a genuine cookie that does not back the token is what `MissingCSRF` means. It
  is what another tab or the worker check (R-40) leaves, so Auth.js's own check refuses
  it and nothing is faked. A cookie in the fulfilled answer would put the right one
  back.

- **D-151-9 · The E2E looks up the alert inside `main`. It sets text size and scroll with
  `page.evaluate` after load, never with an init script.** _Why:_ Next's route announcer
  also has `role="alert"`. Adding no script keeps D-122-8's CSP watch meaningful.
  _Research:_ R-177.
- **D-151-10 · The layout E2E measures at the default text, at 32px (D-111-24) and on a
  340px-tall screen,** the keyboard-up height `teams.spec.ts` uses. Sign in is pressed
  at the end of the page. The message must be on screen and not focused. The page may
  move no further than it takes to bring the message to the top, as D-164-9 bounds it.
  Without the scroll, it fails (iPhone 13 at 32px: -266; Pixel 5 at 340px: -110). It also
  fails with `scroll-clear-nav` on the message (49px and 56px further than needed).
  _Why:_ jsdom lays nothing out (D-164-6).
- **D-151-11 · `sign-in-form.test.tsx` calls `signIn.mockReset()` before each test.**
  _Why:_ `vi.clearAllMocks` keeps queued once-answers, and the new tests queue two each,
  so one a test left unread would answer the next test's sign-in. _Research:_ R-178.
- **D-151-12 · Over plain http with `Secure` cookies, sign-in now says "This page
  expired." on every try, and a reload does not help.** This refines D-122-12's
  trade-off, which named "Email or password is incorrect.". The fix is still
  `auth.secureCookies: false`, and the README and `config.example.yaml` now say so.
  Verified on WebKit, before and after a reload. _Why:_ Safari and LAN phones never send
  the cookie back, so both tries are `MissingCSRF`. The advice to reload is wrong only
  on a run the README already covers.

## Known limits

- **A `signIn` that throws leaves the email form on "Signing in…" with nothing said.**
  Its POST throws when the signal drops mid-submit. With no signal from the start,
  next-auth cannot read the providers and sends the page to `/api/auth/error` instead
  (read in its code). This predates #151. The Google path catches a throw and shows
  `GOOGLE_UNFINISHED` (D-14-6). It is a possible follow-up issue (reviewer), with none
  filed yet.
- **A failed token fetch reads as `MissingCSRF`.** next-auth sends an empty token when it
  cannot fetch one. On a patchy signal, the form resends and can end on "This page
  expired" though the signal was the cause. This is reasoned from next-auth's code
  (R-176) and not tested.
- **D-150's two-cookie case should now recover.** A cookieless request can get two CSRF
  cookies. If the browser keeps the wrong one, the resend fetches a token for the cookie
  it kept. This is reasoned from the code. No test runs it.

## How existing decisions are handled

| Decision          | Effect                                                                         | By       |
| ----------------- | ------------------------------------------------------------------------------ | -------- |
| D-15-1            | Kept; scope stated as refusals about accounts (owner)                          | D-151-3  |
| D-122-12          | Trade-off refined: the plain-http message is now "This page expired."          | D-151-12 |
| D-150 known limit | Noted: the resend should recover a browser that kept the wrong cookie          | D-151-1  |
| D-120-5, D-120-11 | Unchanged: a CSRF refusal charges no budget                                    | D-151-4  |
| D-128-4           | Unchanged: a doubly refused tap is two `MissingCSRF` errors under one throttle | D-151-4  |
| D-14-6            | Unchanged: Google's `?error=MissingCSRF` still reads "didn't finish"           | D-151-6  |
| D-164-2           | Applied to sign-in, with no scroll margin                                      | D-151-7  |
| D-122-8           | Kept: no inline or init script                                                 | D-151-9  |

## Relies on

D-14-6, D-15-1, D-32-12, D-32-19, D-37-3, D-111-24, D-120-1, D-120-5, D-120-11, D-122-8,
D-122-12 (refined), D-128-2, D-128-4, D-129-5, D-164-2, D-164-5, D-164-6, D-164-9.

## Open questions

None. The owner's ruling of 2026-11-13 settled the issue's "decide later". On
2026-11-15 the owner answered PR #184's question, whether "Reload it" fits the
installed app, by keeping D-151-2's wording as built.
