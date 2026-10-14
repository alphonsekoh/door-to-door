# #13 · Auth.js v5 with Drizzle adapter

- **Status:** Done (PR #52)
- **Phase:** 2 - Auth

## Task

Adapter, session strategy, and how a role reaches the app.

## Decisions

- **D-13-1 · JWT session strategy.** Forced, not chosen: the Credentials provider cannot
  use database sessions. **Invariant.** _Research:_ R-2.
- ~~**D-13-2 · Role and deactivation travel on the token.** _Research:_ R-3.~~ Superseded
  by D-83-1 and D-83-3 for authorization: the token still carries them, as UI hints only.
- **D-13-3 · A user with no role defaults to `member`, never `admin`.** _Why:_ an SSO
  sign-up must not grant itself privileges.
- **D-13-4 · `NextAuth()` takes a config function, not an object.** _Why:_ an object
  constructs the adapter at import and makes `next build` need a database. Extended by D-75-9 to config, rate limiter, proxy and db client. The db client is a process-wide singleton since D-87-3.
- **D-13-5 · Logic in `src/server/auth`; root `auth.ts` is a thin wrapper.**
