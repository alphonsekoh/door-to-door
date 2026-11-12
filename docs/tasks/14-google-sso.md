# #14 · Google SSO provider

- **Status:** Done (PR #167)
- **Phase:** 2 - Auth
- **Depends on:** #13, #15, #31, #105. Built with #125 and #162 in one PR.

## Task

Google sign-in, for the addresses an admin has added. Email and password stay as the
fallback. The owner's rulings of 2026-11-05 (comments on #14) narrow the issue, and they
answer this file's two open questions: the credentials come from the owner at deployment,
and an address nobody added is refused. The rulings of 2026-11-12 limit Google to
addresses Google vouches for (D-14-19), and settle the two conflicts this file raised
(D-14-10, D-14-17). Sign-ins themselves are in [125-sign-ins.md](125-sign-ins.md).

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
  (CLAUDE.md, D-75). **Supersedes D-38-4 and D-38-18** ("not built"). _Extended by
  D-14-20:_ `auth.google.domains` is required with it.

- **D-14-3 · Only an address an admin has added can sign in with Google, and signing in
  creates nobody (owner, 2026-11-05).** The `signIn` callback (`allowGoogleSignIn`)
  refuses unless all three hold:
  - Google's `email_verified` is true.
  - An active account has that address.
  - The account Auth.js resolved is that same account. So a Google account linked
    earlier, whose address has since changed, cannot sign in as the old account.

  The adapter's `createUser` is refused as well, and D-13-3 stays as a backstop. The
  issue's "new Google users default to `member`" and its first acceptance criterion are
  dropped. _Research:_ R-148. _Extended by D-14-19 (owner, 2026-11-12):_ Google must also
  vouch for the address.

- **D-14-4 · The first verified sign-in links by email, never by cookie.**
  `allowDangerousEmailAccountLinking` is on. That is safe here, because D-14-3 admits only
  a Google-verified address an admin added. The adapter's `getUser` returns `null`, so
  Auth.js never links the Google account to whoever's cookie is already on the phone.
  _Why:_ on a shared phone, A's stale cookie plus B's Google sign-in would otherwise link
  B's Google to A's account. _Research:_ R-148. _Extended by D-14-19:_ only an address
  Google vouches for is linked, since the link is permanent.
- **D-14-5 · Every Google refusal gets the same message (`googleRefusedMessage`):** "That
  Google account can't sign in here. Google sign-in is for gmail.com, tjc.sg or tjc.org
  addresses your admin added; otherwise, use your email and password." The domains are
  `auth.google.domains`, the same for everyone. It is the same for an unknown, an
  unverified, a not-vouched-for or a deactivated address. That is how D-15-1 and the
  ruling's "same 'can't sign in' message" are met. It is not the credentials' "Email or
  password is incorrect.", which a Google-only account still gets on the email form.
  _Why:_ that wording would send a Google user looking for a password they never had.
  _Changed in review (2026-11-12):_ it was the constant `GOOGLE_REFUSED`, "That Google
  account can't sign in here. Use the email address your admin added." It now names the
  domains (D-14-19), and is short enough to leave both sign-in buttons in view at the
  largest text.
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
  button is in the first paint rather than shifting the form under a thumb. **Supersedes
  D-150-4 (owner, 2026-11-12).** The `no-store` of D-150-1 and D-150-2 is unchanged, and
  the proxy's comment no longer calls the page prerendered. _Why:_ whether Google is set
  up is in `config.yaml`, which `next build` never reads (D-13-4, D-75-9).
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

  Refines D-31-1, and D-31-4: the password is shown only when there is one. _Refined by
  D-14-22:_ a second `409`, for an address outside the domains. _Refined by D-14-24:_ the
  hint.

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
  typo in the email would leave an admin nobody can sign in as. _Refined by D-14-23:_
  only inside the domains.

- **D-14-14 · Nothing calls Google in the tests (owner, 2026-11-05: no real
  credentials).**
  - E2E runs a stand-in OpenID provider, `e2e/fake-google.ts`, with discovery, an
    account chooser, token and JWKS. It is a second Playwright web server on
    `E2E_GOOGLE_PORT` (default `E2E_PORT` + 1000), and `auth.google.issuer` points at
    it. It can send `hd`.
  - Vitest drives Auth.js through the provider's `customFetch`.
  - The Google E2E runs on `localhost`, not `127.0.0.1`.

  _Research:_ R-144, R-149.

- **D-14-15 · The Google G is Google's own mark.** It is kept as `public/google-g.svg`,
  drawn by the `google-mark` utility on a chip in the button's text colour. The button
  itself is `btn-primary`. _Why:_ a brand image, like the app icons, is not one of the
  app's colours, so D-111-5 still holds.
- ~~**D-14-16 · Google's code is `src/server/auth/google.ts`,** with the rest of the auth
  logic. `src/auth/` stays the thin entrypoint.~~ Superseded by D-14-17 (owner,
  2026-11-12).

### Owner rulings of 2026-11-12 and review fixes

- **D-14-17 · Google's code is in `src/auth/`, beside the entrypoint (owner,
  2026-11-12).** `google.ts`, `google.test.ts` and `google.integration.test.ts` moved
  there from `src/server/auth/`. The rest of `src/server/auth` stays. **Supersedes
  D-14-16.** Amends D-115-3's "the logic stays in `src/server/auth`" for Google, and with
  it D-13-5. _Why:_ D-115-3 stands: #14's pieces land in `src/auth/`.
- **D-14-18 · ESLint keeps `src/auth` out of `src/components` and `src/lib`.** It refuses
  `@/auth`, `@/auth/*`, and a relative import matching `^(?:\.\./)+(?:src/)?auth(?:/|$)`.
  Pages pass the forms what they need as props (D-14-21). Extends D-75-17. _Why:_
  Auth.js and `google.ts`, which reads the config, are server-only. A regex, because a
  glob such as `**/auth/*` would also catch `@/server/auth/routes`, which UI imports.
- **D-14-19 · Google signs in only where Google vouches for the address (owner,
  2026-11-12).** On top of D-14-3, `allowGoogleSignIn` requires:
  - the address's domain to be in `auth.google.domains`, matched exactly: no
    subdomains, and `googlemail.com` is not `gmail.com`;
  - at `gmail.com`, nothing more. At any other listed domain, the ID token's `hd` must be
    a string whose lower-cased value is in the list. Any listed `hd` is accepted, not
    only the address's own domain, because a Workspace's secondary domains carry its
    primary domain as `hd` (the app's reading, unverified: R-150, owner check below).

  `hd` is read from the signed ID token, which is the profile Auth.js hands the callback
  for Google. With Google not set up, it refuses everyone. Extends D-14-3 and D-14-4.
  _Why:_ `email_verified` is authoritative only for `@gmail.com`, or when the token
  carries `hd` (Google Workspace). Anywhere else, a mailbox that changed hands lets its
  old holder in, and the link by email (D-14-4) is permanent. _Research:_ R-150, R-151.

- **D-14-20 · `auth.google.domains` is required whenever `auth.google` is set (owner,
  2026-11-12).** It is a non-empty list of lower-case domain names: at least two labels,
  no `@`, no label that starts or ends with a hyphen. The owner's list is `gmail.com`,
  `tjc.sg` and `tjc.org`; both tjc domains are on Workspace (MX `aspmx.l.google.com`).
  Extends D-14-2. _Why:_ required, so leaving it out can never mean "anywhere".
- **D-14-21 · `googleDomains()` replaces `googleSignInEnabled()`.** It returns the list,
  or `null` when Google is not set up, read per request (D-13-4). The domain helpers and
  both "need a password" messages are in `src/lib/session/google-domains.ts`. _Why:_ one
  value says both whether Google is on and where, and the forms can use the helpers
  without importing `src/auth` (D-14-18).
- **D-14-22 · `POST /users` without a password is refused `409` in this order:** Google
  not set up (D-14-12's message), then an address outside the domains: "Google sign-in
  works only for addresses at gmail.com, tjc.sg or tjc.org, so they need a password."
  (the configured list). `openapi.yaml`'s `createUser` text, its `409` and
  `CreateUserRequest.password` state the rule. Refines D-14-12. _Why:_ nobody could sign
  in as such an account.
- **D-14-23 · `create-admin` follows the same rule.** `checkGoogleOnlyAdmin` guards
  `createFirstAdmin(db, input, googleDomains)`. The prompt offers "leave empty for Google
  sign-in only" only for an address inside the domains. An empty password outside them
  is refused before the email is asked again, by a message that names
  `auth.google.domains`. Refines D-14-13. _Why:_ a Google-only first admin outside the
  domains is one nobody can sign in as, and a refusal should cost one prompt.
- **D-14-24 · Add someone offers a Google-only account only where it can work.** The
  hint "Leave empty to sign in with Google only. That works for addresses at gmail.com,
  tjc.sg or tjc.org." shows only when Google is set up. An empty password is refused in
  the form without Google ("Enter an initial password.") and outside the domains
  (D-14-22's message). These checks are affordance only; `POST /users` decides (D-16-2).
  Refines D-14-12. _Why:_ the hint promised Google where the server would refuse it.
- **D-14-25 · The `jwt` callback no longer handles a `signUp` trigger.** _Why:_ it cannot
  happen, because linking by email never creates a user (D-14-3).

## Known limits

- Before the page is live, the Google button is drawn but ignores a tap (verifier round
  1, a nit; the owner may prefer it as it is).
- A Google account whose address changed after it was linked is refused (D-14-3). The
  link has to be fixed by hand.
- Removing `auth.google`, or a domain from `auth.google.domains`, strands the
  Google-only accounts it covered, a Google-only first admin included. Nothing in the
  app can give one a password (D-125-1).
- A Gmail address must be added exactly as Google has it, dots included.
  `jane.doe@gmail.com` and `janedoe@gmail.com` share a mailbox, but only the spelling
  Google reports matches.
- Real Google is unverified until the owner supplies credentials. The production
  redirect URI waits on the deployment domain (#146).

## Owner checks (real devices and real Google; not claimed by the PR)

- From the installed iPhone and Android apps, sign in with Google: the session must come
  back into the app.
- On a shared phone, Google's account chooser must show every time (D-14-8).
- On a slow connection, check that a password manager fills the email form as soon as it
  appears, and that Sign in then works at once.
- A Workspace account at `tjc.sg` and at `tjc.org` signs in; a personal Google account
  made on a tjc address is refused (D-14-19).
- Whether `tjc.org` is a secondary domain or an alias of `tjc.sg`. If it is an alias,
  Google reports the member's `tjc.sg` address, so members must be added at `tjc.sg`.

## Relies on

D-13-1, D-13-3, D-13-4, D-15-1, D-15-6, D-16-2, D-31-5, D-74-4, D-75-2, D-75-17, D-105-3,
D-105-5, D-111-5, D-115-3, D-129-5, D-150-1, D-150-2.

## Open questions

None. The owner settled both conflicts on 2026-11-12: D-14-10 supersedes D-150-4, and
D-115-3 stands (D-14-17 supersedes D-14-16).
