# #120 · Bound the sign-in limiter and slow password spraying

- **Status:** Done (PR #148)
- **Phase:** 7 - Hardening
- **Depends on:** #15, #75, #86, #118

## Task

The credentials limiter kept a window for every email it was sent, with no length cap,
until a restart, so an anonymous client could fill the heap. It also budgeted per email
only, so one common password could be tried against every account unthrottled. Found by
a security audit.

## Decisions

- **D-120-1 · Over-long credentials are refused before any budget, query or argon2.**
  That is a normalised email over 320 characters or a password over 200, the
  `POST /users` caps. A unit test pins both constants to the generated schema.
  `MAX_PASSWORD_LENGTH` moves to `src/server/password.ts`. _Why:_ no account can hold a
  longer value, so nobody is locked out. The fast path depends on the input alone, so it
  reveals nothing about accounts (D-15-2 holds).
- **D-120-2 · The limiter drops expired windows from the front on every `consume`.** A
  new or renewed window is deleted and set again, so the Map stays in expiry order and
  the sweep stops at the first live window. Expiry is still checked on lookup, because
  the clock can step back. The sync limiter (D-21-6) shares the code; it is keyed per
  member, so nothing changes there. _Why:_ memory follows the live windows, not every key
  ever seen, and no timer is needed. ~~The cost is amortised O(1).~~ _Cost corrected by
  the owner (2026-11-03):_ it is not O(1) in V8. Deleted entries stay in the Map as holes
  until a rehash, and each `consume` walks them from the front. The cost is bounded by
  D-120-3's cap. The reviewer measured about 1 µs per `consume` at 1k live keys, 16 µs
  at 10k and 100 µs at 100k (Node 24). _Research:_ R-111.
- **D-120-3 · At most 100,000 keys per limiter, oldest window evicted first. It is a code
  constant, not a config key.** _Why:_ it is a memory guard, not a policy. _Trade-off:_
  flooding 100k distinct emails within one window evicts a target's count, which costs
  about 10,000 requests per extra guess.
- **D-120-4 · Limiter keys and log tags are HMAC-SHA256 digests under a random
  per-process key.** _Why:_ fixed-size keys make D-120-3 a constant bound, and neither
  memory nor logs hold a raw email or address. A plain hash of a guessable email is as
  good as the email. The key is per process because the limiter already is (D-15-3), so
  there is no secret to manage.
- **D-120-5 · A per-client budget, `rateLimit.signInAttemptsPerClient` (default 30),
  counted only when `rateLimit.trustedProxyHops` is at least 1 (default 0).** The client
  is the `X-Forwarded-For` entry that many places from the right. IPv6 is keyed on its
  /64, and IPv4-mapped IPv6 as IPv4. A missing or invalid entry goes into one shared
  `unattributed` bucket, with a throttled warning. **Extends D-15-3, D-75-15 and
  D-86-5:** the per-email budget is unchanged. _Why:_ Next fills the header only when it
  is absent and never appends, so without a configured proxy the client writes it.
  Handlers get no socket address, and no hosting target is chosen yet.
  _Research:_ R-109, R-110.
- **D-120-6 · Every budget is charged up front, in the order global, client, account,
  so only failed attempts are left counting.** The first budget to refuse refunds what
  this attempt took from the ones before it. A success clears the account (D-86-1), but
  on the client and global budgets it refunds only its own attempt. **Extends D-86-5:**
  the limiter gains `refund` and `size`, and a shared store must replace `consume`,
  `reset` and `refund`. **Extends D-86-6:** a success adds at most two in-memory refunds.
  _Why:_ a member signing in must not wipe a sprayer's count off a shared budget.
  Charging up front keeps D-86-2's guarantee against bursts.
- **D-120-7 · `experimental.proxyClientMaxBodySize: "2mb"`. It truncates; it does not
  refuse.** On every path the proxy matches (all but static files), a handler reads at
  most the first 2 MB, and Next logs a warning. Nothing answers `413`, so the issue's
  criterion "bodies above the cap are refused" is met only as "never read". **Narrows
  D-118-6's accepted exposure (owner, 2026-11-03):** a `CreateTeamRequest.memberIds` list
  is bounded at 2 MB per request instead of 10 MB. That is about 53k ids, still past the
  roughly 21,846 at which the insert answers `500`. It does not close #126, which owns an
  explicit refusal in `readJsonBody`. _Why 2 MB, not the issue's 1 MB:_ a full sync
  batch of maximum-length CJK descriptions is about 1.3 MB. A larger one is cut to
  invalid JSON, gets `400` and recovers through isolation (D-33-6). _Trade-off:_ JSON
  padded at its end can still parse after the cut, and the bound holds only where the
  proxy runs. _Research:_ R-108.
- **D-120-8 · Failed and refused sign-ins log through `createThrottledLog`
  (`console.warn`) under four fixed keys** (`sign-in:failed`, `:limited`, `:oversized`,
  `:unattributed`). A line carries at most a 12-character digest tag, never an email or
  address. ~~The Auth.js logger is untouched (#128).~~ _Why:_ a request must not choose
  its own line, and a throttle key built from the request would bring back the unbounded
  Map this issue removes. _Refined by D-128-6:_ the Auth.js logger is now set (#128) and
  leaves `CredentialsSignin` to these lines, and a fifth key, `sign-in:unexpected`, logs
  a credentials check that throws.
- **D-120-9 · No contract change.** Auth.js routes are not in `openapi.yaml`, and
  truncation adds no status code.
- **D-120-10 · D-15-3 is kept: extended, not superseded (owner, 2026-11-03).** The
  per-email budget still refuses the correct password once spent. _Why:_ narrowing the
  lockout to email plus client needs a trustworthy client address, which a default
  deployment does not have. Raise it again once `trustedProxyHops` is in use.
- **D-120-11 · An app-wide budget, `rateLimit.signInAttemptsGlobal`, is built but off
  unless set (owner, 2026-11-03, option B).** It is an incident switch: set it during an
  attack, restart, and remove it afterwards. It is charged first, under one constant key,
  with D-120-6's window and refunds, and is per process like every budget here (D-15-3).
  Rejected: on by default (A) and not built (C). _Why:_ once set, anyone can spend it and
  block every new sign-in, the correct password and admins included. Only existing 30-day
  sessions survive. With tens of accounts, a one-password spray finishes inside any
  budget big enough not to lock out a busy venue, so a standing budget would buy little.
- **D-120-12 · A wrong hop count is documented, not detected.** README and
  `config.example.yaml` warn about each case:
  - A count below the proxies that append keys every client on a proxy's own address:
    one shared bucket anyone can spend, with no warning, since that address is valid.
  - A count above them lets a client that sends its own `X-Forwarded-For` choose its key,
    and leaves clients that send none with no usable entry.
  - A proxy that writes `ip:port` entries leaves no usable entry.

  Sign-ins with no usable entry share the one `unattributed` bucket, and the throttled
  `Sign-in from no usable X-Forwarded-For entry` warning fires. The check after deploying
  is direct: the client's real address must sit exactly `trustedProxyHops` places from the
  right of `X-Forwarded-For` as the app receives it. `config.docker.yaml` pins `0`,
  because Compose publishes the app's port with no proxy in front. _Why:_ the app cannot
  count the proxies in front of it. _Trade-off:_ a count that is too high or too low
  shares one budget of 30, and a count that is too high also lets a client pick its key.
  _Research:_ R-112 (the Azure `ip:port` report is unchecked).

- **D-120-13 · The body-cap E2E sends the CSRF token ahead of a 2.5 MB pad and asserts
  that the refusal is `CredentialsSignin`.** With a 1 KB pad, the same request signs in.
  _Why:_ with the token behind the pad, the refusal is `MissingCSRF`, which proves
  nothing about the credentials going unread. Only the production build shows the cap
  (as with D-118-4). _Research:_ R-108.
- **D-120-14 · Scope cut.** These are left to their own issues: an explicit body refusal
  (#126), the Auth.js logger (#128), and password change (#125). Password change matters
  most for spraying, because members cannot change the initial passwords admins choose.
  _Why:_ each is a separate change with its own decisions.

### How existing decisions are handled

| Decision | Effect                                                                  | By                          |
| -------- | ----------------------------------------------------------------------- | --------------------------- |
| D-15-3   | Kept, extended (owner): per-client and app-wide budgets beside it       | D-120-5, D-120-10, D-120-11 |
| D-86-5   | Extended: `refund` and `size`; a shared store replaces three operations | D-120-6                     |
| D-86-6   | Extended: a success adds at most two in-memory refunds                  | D-120-6                     |
| D-75-15  | Extended: three `rateLimit` keys                                        | D-120-5, D-120-11           |
| D-118-6  | Exposure narrowed (owner): 2 MB per request, not 10 MB; #126 stays open | D-120-7                     |
| D-21-6   | Unchanged: the sync limiter gets the same sweep and cap                 | D-120-2, D-120-3            |

## Relies on

D-13-4, D-15-1, D-15-2, D-15-3 (extended), D-16-2, D-21-6, D-33-6, D-75-9, D-75-15,
D-86-1, D-86-2, D-86-3, D-86-4, D-86-5, D-86-6, D-118-4, D-118-6.

## Open questions

None. The owner answered the plan's question on an app-wide budget with option B
(D-120-11).
