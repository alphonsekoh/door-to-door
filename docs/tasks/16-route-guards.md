# #16 · Route guards

- **Status:** Done (PR #54)
- **Phase:** 2 - Auth
- **Depends on:** #13

## Task

Keep signed-out visitors out of pages, and enforce roles in handlers.

## Decisions

- **D-16-1 · `src/proxy.ts` is an optimistic redirect only** _(refined by D-279-15: `/api/retention/run` alone skips `auth()`)_, built from
  `baseAuthConfig` without the adapter. API paths get `401` JSON; pages redirect with
  `callbackUrl`. _Research:_ R-4. _Refined by D-163-8:_ `callbackUrl` never carries a
  `q`; a query without one passes byte for byte. _Refined by D-124-8 (owner):_ under
  `next dev` only, the proxy first answers `403` to a `Host` that is not loopback. That
  is a network guard for the dev server, not authorization, so D-16-2 holds.
- **D-16-2 · `requireUser` / `requireRole` in every handler are the real guard.** Client
  role checks (`useRole`) are affordance only. **Invariant.** _Amended by D-83-2, D-83-12:_
  the session passed to the guards must come from `currentSession`. _Extended by D-249-4
  (#249):_ `requireUser` refuses an unapproved account, failing closed; only `/users/me`
  uses `requireOwnAccount`, pinned by a scan test.
- **D-16-3 · Deactivation is checked per request and returns `403`, not `401`.** _Why:_
  a deactivated user should be told to see an admin, not to sign in again. _Amended by
  D-83-1:_ the check reads the database; until #83 it only read the token flag.
- **D-16-4 · `resolveMemberScope` refuses a member asking for another member's
  records.** Reused for authorship in D-29-1.
