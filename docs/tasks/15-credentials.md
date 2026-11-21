# #15 · Credentials sign-in

- **Status:** Done (PR #53)
- **Phase:** 2 - Auth
- **Depends on:** #9, #13

## Task

Email and password sign-in with argon2, and the sign-in form.

## Decisions

- **D-15-1 · Every failure looks identical** — unknown email, wrong password,
  deactivated, SSO-only. _Why:_ otherwise the form lists who has an account. _Scope
  stated by D-151-3 (owner, 2026-11-13):_ it covers refusals about accounts, a spent
  budget included. A refusal by Auth.js's CSRF check, made before the credentials are
  read, is resent once and then says the page expired (D-151-1, D-151-2). _Superseded
  for Google sign-in by D-249-17 (owner, 2026-11-21):_ Google shows the holder of an
  address whether it has an account, waits, or was turned down. The email form keeps
  this rule for every refusal.
- **D-15-2 · Unknown emails verify against a decoy hash.** _Why:_ response time was an
  enumeration oracle. _Research:_ R-10.
- **D-15-3 · Per-email, fixed-window, in-memory rate limit.** Single-instance only;
  replace `consume()` to share it. A spent budget refuses the correct password too.
  _Narrowed by D-86-1 and D-86-5:_ only failed attempts count, a success clears the
  count, and sharing means replacing `consume()` and `reset()`. The spent-budget refusal
  stands (D-86-3). _Kept and extended by D-120-5, D-120-6, D-120-10 and D-120-11 (owner,
  2026-11-03):_ the per-email budget is unchanged, and per-client and app-wide budgets
  sit beside it. Sharing now means replacing `consume()`, `reset()` and `refund()`.
- **D-15-4 · `authorizeFromRawCredentials` is extracted and tested directly.** _Why:_
  Auth.js wraps `authorize`, so tests through the provider asserted nothing.
- **D-15-5 · Admin user creation and password change deferred to #31.** _Why:_ needed
  endpoints not yet in the contract.
- **D-15-6 · The sign-in `callbackUrl` is followed only if it resolves to this origin**,
  resolved as the browser would (against a placeholder origin), and the resulting path
  resolved again; anything else goes to `/`. Added in PR #93. _Why:_ it comes from the
  query string, and the URL parser strips tab/CR/LF and collapses dot segments, so
  `/\t/evil.example` or `/.//evil.example` pass a string check and leave the site.
- **D-15-7 · A successful sign-in leaves the page with a full load (`goTo`), not
  `router.refresh()` then `router.push()`.** Supersedes D-37-3's sign-in clause; added in
  PR #93. _Why:_ the refresh of `/sign-in` could outlive the push, and when it failed, Next
  hard-loaded `/sign-in` over the signed-in home. A full load also starts with an empty
  router cache, so D-37-3's cached-redirect problem (R-13) stays fixed. D-15-6 relies on
  it, because a full load follows any URL it is given.
