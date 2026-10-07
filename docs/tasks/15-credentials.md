# #15 · Credentials sign-in

- **Status:** Done (PR #53)
- **Phase:** 2 - Auth
- **Depends on:** #9, #13

## Task

Email and password sign-in with argon2, and the sign-in form.

## Decisions

- **D-15-1 · Every failure looks identical** — unknown email, wrong password,
  deactivated, SSO-only. _Why:_ otherwise the form lists who has an account.
- **D-15-2 · Unknown emails verify against a decoy hash.** _Why:_ response time was an
  enumeration oracle. _Research:_ R-10.
- **D-15-3 · Per-email, fixed-window, in-memory rate limit.** Single-instance only;
  replace `consume()` to share it. A spent budget refuses the correct password too.
- **D-15-4 · `authorizeFromRawCredentials` is extracted and tested directly.** _Why:_
  Auth.js wraps `authorize`, so tests through the provider asserted nothing.
- **D-15-5 · Admin user creation and password change deferred to #31.** _Why:_ needed
  endpoints not yet in the contract.
