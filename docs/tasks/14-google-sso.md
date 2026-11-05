# #14 · Google SSO provider

- **Status:** In progress, with #125 (branch `feat/125-sign-ins-and-google`; PR not yet
  open)
- **Phase:** 2 - Auth
- **Depends on:** #13, #15, #31, #105. Built with #125 and #162 in one PR.

## Task

Google sign-in, for the addresses an admin has added. Email and password stay as the
fallback. The owner's rulings of 2026-11-05 (comments on #14) narrow the issue, and they
answer this file's two open questions: the credentials come from the owner at deployment,
and an address nobody added is refused. Sign-ins themselves are in
[125-sign-ins.md](125-sign-ins.md).

## Decisions

- **D-14-1 · Google is the main sign-in. Email and password stay in production as the
  fallback, and for local development and the automated tests (owner, 2026-11-05).**
  With Google set up, `/sign-in` shows "Sign in with Google" first, then "or", then the
  email form with a secondary "Sign in". Without Google, it shows the form alone, as
  before.
- **D-14-2 · Google is set up in config, not in env vars.**
  - Google is registered only when `config.yaml` has `auth.google` (`clientId`).
  - The secret is `AUTH_GOOGLE_SECRET` or `AUTH_GOOGLE_SECRET_FILE`, required once
    `auth.google` is set.
  - `auth.google.issuer` exists only to point at a stand-in provider in tests.
    Production never sets it.

  _Why:_ the issue's `AUTH_GOOGLE_ID` is a setting, and settings are config keys
  (CLAUDE.md, D-75). **Supersedes D-38-4 and D-38-18** ("not built").

- **D-14-3 · Only an address an admin has added can sign in with Google, and signing in
  creates nobody (owner, 2026-11-05).** The `signIn` callback (`allowGoogleSignIn`)
  refuses unless all three hold:
  - Google's `email_verified` is true.
  - An active account has that address.
  - The account Auth.js resolved is that same account. So a Google account linked
    earlier, whose address has since changed, cannot sign in as the old account.

  The adapter's `createUser` is refused as well, and D-13-3 stays as a backstop. The
  issue's "new Google users default to `member`" and its first acceptance criterion are
  dropped. _Research:_ R-144.

- **D-14-4 · The first verified sign-in links by email, never by cookie.**
  `allowDangerousEmailAccountLinking` is on. That is safe here, because D-14-3 admits only
  a Google-verified address an admin added. The adapter's `getUser` returns `null`, so
  Auth.js never links the Google account to whoever's cookie is already on the phone.
  _Why:_ on a shared phone, A's stale cookie plus B's Google sign-in would otherwise link
  B's Google to A's account. _Research:_ R-144.
- **D-14-5 · Every Google refusal gets one fixed message, `GOOGLE_REFUSED`:** "That Google
  account can't sign in here. Use the email address your admin added." It is the same
  for an unknown, an unverified or a deactivated address. That is how D-15-1 and the
  ruling's "same 'can't sign in' message" are met. It is not the credentials' "Email or
  password is incorrect.", which a Google-only account still gets on the email form.
  _Why:_ that wording would send a Google user looking for a password they never had.
- **D-14-6 · Callback errors show one of two fixed messages, never the raw value**
  (`googleSignInMessage`). `?error=AccessDenied` shows D-14-5's message. Any other value
  shows "Google sign-in didn't finish. Try again, or sign in with your email and
  password." _Why:_ anyone can write the query string, and a callback error must read
  as a usable message, never a stack trace.
- **D-14-7 · No Google tokens are kept** (`account()` returns `{}`). The profile sets no
  name and no picture, so Google never changes an account. _Why:_ nothing calls Google
  on anyone's behalf, and the name is the admin's or the member's to set (D-74-4).
- **D-14-8 · Every Google sign-in sends `prompt=select_account`.** _Why:_ on a shared
  phone, the next member must pick their own account, never be signed in silently as the
  last one.
- **D-14-9 · Before leaving for Google, the form does what the email form does after
  signing in.** It waits for D-129-5's look, then clears the worker caches and the local
  copy. _Why:_ the way back from Google lands on the app, not on `/sign-in`.
- **D-14-10 · `/sign-in` renders per request** (`await connection()`), so the Google
  button is in the first paint rather than shifting the form under a thumb. **Pending
  the owner: this conflicts with D-150-4** (see Open questions). The `no-store` of
  D-150-1 and D-150-2 is unchanged.
- **D-14-11 · The email form waits for the page to be live** (`useLive`). Google's button
  and the server's messages are in the server's HTML, with nothing to type into.
  Refines D-113-6, which this keeps true. Before this, the server's HTML held the form as
  a plain GET form. Go before the scripts arrived put the password in the address bar,
  and what was typed was emptied once the page was live (verifier, round 0).
  `signInThroughForm` no longer waits for hydration.
- **D-14-12 · `POST /users` takes an optional password. With none, the account is
  Google-only (owner, 2026-11-05).**
  - With no password while Google is not set up, it is `409 conflict` "Google sign-in
    isn't set up here, so they need a password."
  - Add someone hints "Leave empty to sign in with Google only." On success it says
    "{email} can sign in with Google."

  Refines D-31-1, and D-31-4: the password is shown only when there is one.

- **D-14-13 · `npm run create-admin` can make a Google-only first admin (owner,
  2026-11-05).**
  - With `auth.google` set, leave the password prompt empty, then type the email again
    at a no-echo prompt (compared trimmed and lower-cased). The admin is stored with no
    hash.
  - Without `auth.google`, an empty password is refused.
  - With no terminal and no `ADMIN_PASSWORD(_FILE)`, it refuses as before. That message
    does not mention that a terminal allows a Google-only admin.
  - It still works only once (D-105-3), under the same lock (D-105-5).

  Refines D-105-2: a Google-only admin's test passes `allowGoogleSignIn`, not
  `authorizeCredentials`. Refines D-105-7: the password is optional at a terminal.
  Refines D-105-8: the 8 to 200 characters apply only when a password is given. _Why:_ a
  typo in the email would leave an admin nobody can sign in as.

- **D-14-14 · Nothing calls Google in the tests (owner, 2026-11-05: no real
  credentials).**
  - E2E runs a stand-in OpenID provider, `e2e/fake-google.ts`, with discovery, an
    account chooser, token and JWKS. It is a second Playwright web server on
    `E2E_GOOGLE_PORT` (default `E2E_PORT` + 1000), and `auth.google.issuer` points at
    it.
  - Vitest drives Auth.js through the provider's `customFetch`.
  - The Google E2E runs on `localhost`, not `127.0.0.1`.

  _Research:_ R-140, R-145.

- **D-14-15 · The Google G is Google's own mark.** It is kept as `public/google-g.svg`,
  drawn by the `google-mark` utility on a chip in the button's text colour. The button
  itself is `btn-primary`. _Why:_ a brand image, like the app icons, is not one of the
  app's colours, so D-111-5 still holds.
- **D-14-16 · Google's code is `src/server/auth/google.ts`,** with the rest of the auth
  logic. `src/auth/` stays the thin entrypoint. **Pending the owner: this conflicts with
  D-115-3** (see Open questions).

## Known limits

- Before the page is live, the Google button is drawn but ignores a tap (verifier round
  1, a nit; the owner may prefer it as it is).
- A Google account whose address changed after it was linked is refused (D-14-3). The
  link has to be fixed by hand.
- Add someone always offers to leave the password empty, whether or not Google is set
  up. Without Google, the server refuses that with D-14-12's `409` message.
- Real Google is unverified until the owner supplies credentials. The production
  redirect URI waits on the deployment domain (#146).

## Owner checks (real devices and real Google; not claimed by the PR)

- From the installed iPhone and Android apps, sign in with Google: the session must come
  back into the app.
- On a shared phone, Google's account chooser must show every time (D-14-8).
- On a slow connection, check that a password manager fills the email form as soon as it
  appears, and that Sign in then works at once.

## Relies on

D-13-1, D-13-3, D-15-1, D-15-6, D-31-5, D-74-4, D-75-2, D-105-3, D-105-5, D-111-5,
D-129-5, D-150-1, D-150-2.

## Open questions

Both are conflicts with accepted decisions. Neither is superseded until the owner agrees.

- **D-14-10 against D-150-4.** D-150-4 says: "`/sign-in` stays prerendered; it is not
  made dynamic. _Why:_ D-150-1 is needed anyway for the `307`, the `401` and API answers.
  Making the page dynamic would fix only that one page, and would render it on every
  request for no gain." D-14-10 renders `/sign-in` per request, so the Google button is
  in the first paint. Whether Google is set up is in `config.yaml`, which `next build`
  never reads (D-13-4, D-75-9).
  - Nothing breaks at runtime, since D-150-2 still marks the page `no-store`.
  - If both stand, D-150-4 describes a page that no longer exists. A change made to
    honour it would drop Google from the first paint, or need config at build time.
  - Does D-14-10 supersede D-150-4?
- **D-14-16 against D-115-3.** D-115-3 (owner) says: "`auth.ts` moves to
  `src/auth/index.ts`, imported as `@/auth` (owner). Google SSO (#14) and its pieces land
  in the same folder. Refines D-13-5: the logic stays in `src/server/auth`, only the thin
  wrapper moves." The PR put all of Google's code in `src/server/auth/google.ts` and
  nothing in `src/auth/`.
  - Nothing breaks at runtime, and both folders are gated at 100%.
  - If both stand, the record places Google in `src/auth/`, where it is not. A later
    change that follows D-115-3 would split Google's code across two folders.
  - Should D-115-3 be amended (Google's logic stays in `src/server/auth`, as D-13-5 has
    it), or the code moved?
