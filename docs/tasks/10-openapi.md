# #10 · Author openapi.yaml

- **Status:** Done (PR #49)
- **Phase:** 1 - Data & Contract

## Task

The API contract every handler and form validates against.

## Decisions

- **D-10-1 · `openapi.yaml` is the source of truth; change it first.** **Invariant.**
- **D-10-2 · One error envelope with a closed `ErrorCode` set; every list paginated via
  `PaginationMeta`.**
- **D-10-3 · `HouseholdIdentity`: omitting a field and sending `null` both leave it
  untouched.** Implements D-07-1 at the API boundary. _Refined by D-119-7:_ so does a
  `name` or `contact` of only spaces.
- **D-10-4 · Every operation may return `403 account_deactivated`.** _Why:_ JWTs issued
  before deactivation stay valid, so deactivation is re-checked per request. _Research:_ R-2. _Since D-83-1:_ the `403` comes
  from the database row, not the token.
- **D-10-5 · Reused id on `POST /visits` is `409`; replay via `/visits/sync` is
  `unchanged`.** _Why:_ that difference is the offline story.
- **D-10-6 · `/history/mine` is its own operation, not a `memberId` filter.** _Why:_ no
  parameter combination may let a member reach another's records.
- **D-10-7 · `GET /sessions/active` 404 is a normal empty state.**
- **D-10-8 · Reopen is a first-class operation.** _Why:_ ending by mistake locks members
  out of amending.
