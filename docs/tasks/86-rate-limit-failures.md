# #86 · Sign-in rate limit counts only failures

- **Status:** Done (PR #95)
- **Phase:** 2 - Auth
- **Depends on:** #15, #75

## Task

Bug fix. The sign-in limit counted successful sign-ins too, so repeated legitimate
sign-ins (E2E loops, a shared phone) locked an account out until the window passed or the
server restarted.

## Decisions

- **D-86-1 · Only failed attempts count; a successful sign-in clears the email's count.**
  Owner chose option 1 of #86. **Narrows D-15-3** (what counts as an attempt); the rest of
  D-15-3 stands. _Why:_ the limit exists to stop guessing, and a success is not a guess.
- **D-86-2 · Charge every attempt before the password check, then clear on success.**
  Rejected: counting only after a failure. _Why:_ a concurrent burst would all pass the
  check before any was counted; a test shows that version letting the eighth guess of a
  burst through a limit of 3.
- **D-86-3 · A spent budget still refuses the correct password, with the same response,
  and does not clear the count.** Keeps D-15-3 unchanged for a spent budget. The refusal
  returns before the password is checked, so it never reaches the clear. _Why:_ a response
  that changes on the right guess is an oracle.
- **D-86-4 · A deactivated account's correct password does not clear the count.** _Why:_
  it is a refusal (D-15-1), not a sign-in.
- **D-86-5 · The limiter gains `reset(key)`; a shared store must replace `consume()` and
  `reset()`.** **Narrows D-15-3** ("replace `consume()` to share it"). Still per email,
  fixed-window, in-memory, per instance, and set by `rateLimit.signInAttempts` /
  `signInWindowSeconds` (D-75-15). _Why:_ clearing on success needs a second operation.
- **D-86-6 · Timing: a success adds one in-memory `Map.delete`; nothing else moves.** A
  success and a failure each still cost one argon2 verify; a refused attempt was already
  fast and is unchanged. New test: success and failure take comparable time. _Why:_ no
  new timing oracle (D-15-2).
- **D-86-7 · Accepted trade-off: the owner's own sign-in resets an attacker's budget.** A
  guesser targeting an email gets a fresh budget each time the real user signs in before
  it is spent. _Why:_ consequence of D-86-1; the alternative is locking out real users.

## Relies on

D-15-1, D-15-2, D-15-3 (narrowed), D-15-4, D-75-9, D-75-15.

## Open questions

None.
