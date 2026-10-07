# #14 · Google SSO provider

- **Status:** Open — blocked on OAuth credentials from the owner
- **Phase:** 2 - Auth
- **Depends on:** #13

## Task

Google sign-in, linking to an existing user by verified email, new users as `member`.

## Decisions

None yet.

## Relies on

D-13-1 (JWT), D-13-3 (default role `member`), D-15-1 (identical failure messages).

## Open questions

- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and the redirect URI for each environment.
- Should a Google sign-in for an email an admin has **not** added be refused, or
  create a member? D-13-3 makes it safe either way; it is a product call.
