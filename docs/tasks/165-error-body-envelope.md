# #165 · ApiRequestError reads any error body, not only the envelope

- **Status:** Done (PR #169)
- **Phase:** 7 - Hardening
- **Depends on:** #33, #85, #119

## Task

Every contract route answers an error in the `{ error }` envelope (D-12-1), but an answer
from outside the contract, from a reverse proxy or the platform, may not. For such a JSON
body, building `ApiRequestError` threw a `TypeError`. The caller then saw an unexpected
exception instead of the request's own failure, a `401` raised no account message, and
the sync queue read the refusal as lost signal. The #129 verifier found it on PR #161.
Client only: no contract or schema change.

## Decisions

- **D-165-1 · The envelope is recognised by its shape, not by checking `error.code`
  against `ErrorCode`.** A string code and message pass through as they are, a code this
  build does not know included. _Why:_ a phone can run an older cached build against a
  newer server, and that server's code and words should still reach it. D-10-2's closed
  set binds the server, and D-33-16 already holds an unknown code for a tap.
- **D-165-2 · Anything else is outside the contract, and its text is never shown.** If
  `error.code` or `error.message` is not a string, the whole body is ignored. The error
  keeps the status, with `internal_error`, "Something went wrong." and no `details`, as
  an HTML or empty body already did. A `401` among them now raises the account message,
  and a `403` raises none (D-85-2). _Why:_ only the status belongs to the request; a
  proxy's words were not written for the member. _Effect:_ the callers that show
  `error instanceof Error ? error.message : fallback` used to show the `TypeError`'s text
  ("Cannot read properties of undefined …") for such a body. They now show "Something
  went wrong.", and no caller changed. _Since #194_ those callers use `failureLine`
  (D-194-1), which still shows "Something went wrong." for such a body (D-194-3).
- **D-165-3 · `details` keeps only entries with a string `path` and a string
  `message`.** Others are dropped one by one, and a `details` that is not a list becomes
  `[]`. Keeps D-119-16: the contract's `FieldError` always passes. _Why:_
  `src/lib/not-saved.ts` reads `issue.path` to find the field, and one bad entry must not
  break the form.
- **D-165-4 · The constructor takes `body: unknown`, and building the error never
  throws.** The `as never` casts that five test files needed to build one are gone.
  _Why:_ the old `ErrorBody | undefined` parameter made `apiFetch` cast the parsed body,
  which hid the missing check.
- **D-165-5 · In the sync queue, a JSON refusal outside the envelope gets the outcome
  for its status, as an HTML or empty body already did (owner, 2026-11-12).** `400` and
  `413` turn isolation on, and quarantine a record sent alone as `invalid` (D-33-6,
  D-126-11). `401` pauses the queue as signed out (D-85-2, D-33-17). `429` waits out the
  rate limit. Every other status backs off as a server failure. `classify.ts` is
  unchanged. The reviewer agreed.
  _Why:_ such a body used to read as no signal only because the `TypeError` fell into
  `transport.ts`'s catch-all, and D-33-5 keeps no signal for no answer at all. Nothing
  unsent is deleted (D-33-2), and a quarantined record can still be retried with a tap.

## Evidence

With `src/lib/api-client.ts` reverted, 12 of the 17 new tests fail (builder; confirmed by
the reviewer). Among them are the sync transport's bare `413` and the `401` that must raise
the account message. The other five pin what the old code already did: an unknown code, an
HTML body, an empty body, `{ "error": "Forbidden" }` and `null`.

## Relies on

D-10-2, D-12-1, D-33-2, D-33-5, D-33-6, D-33-16, D-33-17, D-85-1, D-85-2, D-119-16,
D-126-11.

## Open questions

None.
