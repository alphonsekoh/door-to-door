# #186 · A late teams request in the block-screen tests

- **Status:** Done (PR #189), with #176
- **Phase:** 7 - Hardening
- **Depends on:** #74

## Task

Main's CI (run 43546976498, attempt 1) failed on one unhandled `TypeError` in
`findMyTeam`. A block-screen test had swapped in a catch-all mock that answered the
viewer's teams request with the unit list. Test only: the app cannot meet this, since
`withContract` checks the teams answer (D-12-1). Built in commit b2bde91.

## Decisions

- **D-186-1 · Every catch-all mock a test swaps in goes through `answerWith`.** It
  answers the teams path with `{ data: [] }` and hands every other path to the test's own
  answer. Each test still asserts what it did. _Why:_ the screen asks for the team once it
  knows the session and the viewer (D-74-52), which on a slow runner can be after the
  swap.
- **D-186-2 · It matches any path ending in `/teams`, and covers the five mocks whose
  session answer fails as well as the two that answer it.** _Why:_ then no mock can give
  the teams path anything but a team list, for any session id, without reasoning about
  which tests can ask.
- **D-186-3 · Mocks that already answer the teams path, never answer, reject everything
  or go through `serve` are left alone.** _Why:_ #160 is editing this file's fixtures for
  paging, so the change stays small.

## Evidence

- **The gap:** in a throwaway copy, with the session answer held until after the swap,
  the old mock passed both named tests and raised CI's `TypeError` at `findMyTeam`. With
  `answerWith` it raised nothing (builder and verifier).
- **Under load:** 40 runs of the file, four at a time (builder), and 20 beside the full
  E2E suite (verifier): no unhandled errors.

## Known limits

- Other block-screen tests still fail now and then under load, none through the teams
  path: "re-reads the units once a queued record reaches the server, and not before",
  "saves a unit an admin added since the list was read, and shows it on the list", "never
  takes away a unit shown because a later read got less" and "shows the units that
  arrived when a later page drops on first open, and saves none". The first two wait for
  a request, then assert at once on an answer drawn in a transition (D-155-2), which
  D-88-4 warns against. All four are in tests #160 is editing. No issue is filed.

## Relies on

D-12-1, D-37-4, D-74-52, D-88-1, D-88-4.

## Open questions

- **Owner:** file an issue for the four block-screen flakes in Known limits, to be
  worked after #160 lands?
