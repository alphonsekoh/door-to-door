# #16 · Route guards

- **Status:** Done (PR #54)
- **Phase:** 2 - Auth
- **Depends on:** #13

## Task

Keep signed-out visitors out of pages, and enforce roles in handlers.

## Decisions

- **D-16-1 · `src/proxy.ts` is an optimistic redirect only**, built from
  `baseAuthConfig` without the adapter. API paths get `401` JSON; pages redirect with
  `callbackUrl`. _Research:_ R-4.
- **D-16-2 · `requireUser` / `requireRole` in every handler are the real guard.** Client
  role checks (`useRole`) are affordance only. **Invariant.**
- **D-16-3 · Deactivation is checked per request and returns `403`, not `401`.** _Why:_
  a deactivated user should be told to see an admin, not to sign in again.
- **D-16-4 · `resolveMemberScope` refuses a member asking for another member's
  records.** Reused for authorship in D-29-1.
