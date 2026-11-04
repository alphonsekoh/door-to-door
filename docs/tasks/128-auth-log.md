# #128 · Auth.js logs one sanitised line, never request text or claims

- **Status:** Done (PR #152, with #150)
- **Phase:** 7 - Hardening
- **Depends on:** #13, #87, #120

## Task

`buildBaseAuthConfig` set no `logger`, so Auth.js used its default logger. That logger
printed a crafted session cookie's own text, so one anonymous request could forge log
lines and terminal escapes. It also printed an expired cookie's decrypted claims. Found
by the 2026-10-28 security audit. This change ships in one PR with #150.

## Decisions

- **D-128-1 · One Auth.js logger, set in `buildBaseAuthConfig`
  (`src/server/auth/auth-log.ts`).** Both the proxy's instance and the `/api/auth`
  route's inherit it. _Why:_ both decode the session cookie. The default logger prints
  the error's message, the wrapped error's stack, and the cause's other properties in
  colour escapes. Those properties are where jose puts an expired token's claims.
  _Research:_ R-120.
- **D-128-2 · An error is one line, `[auth][error] <type> (cause <label>)`.** The first
  label is an `AuthError`'s `type`, or another error's code or name. The wrapped cause is
  labelled by its `code`, else its `name`, else `unknown`. Every label must match
  `^[\w$-]{1,64}$`. A message, stack or cause property is never logged. **This deviates
  from #128's proposal of the cause's class name.** _Why:_ the production build mangles
  class names, and mangles them differently in the proxy's bundle and the route's, so one
  jose error came out as two meaningless lines (builder finding). Auth.js's types and
  jose's and Node's codes are string literals, which survive minification. A `name` is
  reliable only for built-ins such as `TypeError`. The pattern keeps any text a request
  chose out of the line. _Research:_ R-120, R-121.
- **D-128-3 · A warning logs only its code, and debug output is always dropped.** A
  warning is `[auth][warn] <code>` (`unknown` if the code fails D-128-2's pattern),
  through `console.warn`. Debug does nothing, even with `debug: true`. _Why:_ debug
  metadata holds request bodies, the password among them, and cookies.
- **D-128-4 · Lines go through `createThrottledLog`, keyed by the line itself, with a
  60 s quiet period instead of D-87-5's 5 s.** _Why:_ anyone can trigger these lines
  without signing in, as with the sign-in lines, which are also throttled for 60 s
  (D-120-8). Labels come from library constants, so a request cannot add keys, which is
  D-120-8's concern.
- **D-128-5 · The throttles are process-wide, on `Symbol.for("door-to-door.auth-log")`.**
  Each module graph builds its own logger, and its `instanceof` checks use that graph's
  Auth.js. Only the throttles are shared. **This extends D-87-3's pattern, and is an
  exception to D-87-7's module-scope throttles.** _Why:_ the proxy and the route are
  separate module graphs, and both decode the cookie. With a throttle each, one forged
  request would be logged twice. In the verifier's test, 30 decodes wrote one line.
- **D-128-6 · `CredentialsSignin` is left to the sign-in log, so a failed sign-in writes
  at most one throttled line. A fifth key, `sign-in:unexpected`, logs a credentials check
  that throws.** That key covers any throw that is not a `SignInError`, such as a
  database outage, as `summarizeError`'s line. A credentials POST that is missing the
  email or password field now logs nothing. **Refines D-120-8.** _Why:_ Auth.js reports
  every refused `authorize` as `CredentialsSignin`. Before this change, each failed
  attempt also printed a multi-line `CredentialsSignin` stack beside the digest-tagged
  line (#120 verifier), and a database outage was hidden inside that stack.
  _Trade-off:_ a malformed sign-in leaves no trace in the log.
- **D-128-7 · `sanitizeMessage` cuts at the first CR, LF, U+2028 or U+2029. Before
  redaction, it replaces every remaining `\p{Cc}` character (C0, DEL, C1) with U+FFFD.**
  **Refines D-87-4**, which cut at LF only. _Why:_ a message can carry text a request
  chose. A CR or U+2028 can start a forged line in a terminal or log viewer, and ESC or
  CSI starts colour, cursor and title escapes. The rule reaches every `summarizeError`
  caller: the pool, `withContract`, sync and `sign-in:unexpected`.

### How existing decisions are handled

| Decision | Effect                                                                                            | By      |
| -------- | ------------------------------------------------------------------------------------------------- | ------- |
| D-120-8  | Refined: the Auth.js logger is set and leaves `CredentialsSignin` to the sign-in log; a fifth key | D-128-6 |
| D-87-4   | Refined: cut at any line break, control characters replaced                                       | D-128-7 |
| D-87-3   | Pattern extended to the Auth.js log throttles                                                     | D-128-5 |
| D-87-7   | Exception: the Auth.js log throttles are process-wide                                             | D-128-5 |
| D-87-5   | Unchanged for its keys; the Auth.js lines use 60 s, as the sign-in lines do                       | D-128-4 |

## Evidence

From the #128 verifier, against the production build. A forged JWE whose `crit` held CR,
LF, ESC, OSC, BEL and U+2028 was sent 10 times to `/history` and 10 times to
`/api/auth/session`, which is 30 decodes. The log got one line,
`[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED)`, with no injected text.
An expired token with the real secret was sent 30 times and gave
`(cause ERR_JWT_EXPIRED)`, and none of its claims reached the log. The log held no ESC or
CR byte and no email address.

## Known limits

- The 60 s quiet period of the process-wide logger has no test of its own. The throttle
  itself is tested in `error-log.test.ts` (reviewer nit).
- `sign-in:unexpected` was not checked against the production build, because that needs a
  database outage. Vitest covers it.

## Relies on

D-13-4, D-13-5, D-15-2, D-87-3, D-87-4 (refined), D-87-5, D-87-7, D-120-4, D-120-8
(refined).

## Open questions

None.
