# #88 · Flaky unit tests under load: block-attach-sheet and update-prompt

- **Status:** Done (PR #94)
- **Phase:** 7 - Hardening
- **Depends on:** #28, #32, #37

## Task

Two component test files failed under CPU load and passed alone. Per D-37-4 a flaky test
is not retried, so each failure was traced to its cause. Both files were also checked for
the same pattern.

## Decisions

- **D-88-1 · Tests wait for the sheet's delayed block load, then assert on the request
  that matters.** "Refuses a half-filled block" waits for a listed block and asserts no
  `POST /blocks`, not "no fetch at all". The other tests exposed to the same load wait for
  it too. _Why:_ the list loads on a 200 ms debounce after opening, and under load it
  landed after the mock was cleared.
- **D-88-2 · "Reports a duplicate block" fails only the create and asserts exactly one
  create.** _Why:_ when every request failed, a late list request could raise the same
  alert with no create sent, so the test passed for the wrong reason.
- **D-88-3 · `BlockAttachSheet` ignores an error from a superseded search as well as its
  rows.** Extends D-28-7 to the failure path. _Why:_ a slow failing request could put an
  alert over a list that had already loaded. This was a real component bug, not a test
  bug. _Extended by D-234-4_ to Admin Sessions and a session's page, and by D-245-6 to
  All records.
- **D-88-4 · update-prompt tests wait for the observable effect, not the first sign of
  it.** "Reserves room at the top" waits for `--banner-top` to be set, and "holds off
  while saved visits have not synced" uses `findByText`. _Why:_ the banner appears after
  `serviceWorker.ready` resolves, outside `act`. React can draw it and run the
  `useReservedSpace` effect on separate tasks.
- **D-88-5 · Tests that expect silence first check that watching started.** The "says
  nothing" tests assert the `updatefound` listener was attached. _Why:_ otherwise the
  test can pass before the component has done anything.
- **D-88-6 · `useReservedSpace` stays on `useEffect`.** _Why:_ the hook is shared with
  install-prompt. `useLayoutEffect` would also remove a one-frame banner overlap, but that
  is a behaviour change, so the owner decides (see open questions).

## Relies on

D-37-4 (no retries), D-28-7, D-32-13.

## Open questions

- Should `useReservedSpace` switch to `useLayoutEffect`? That would remove the one-frame
  overlap before `--banner-top` / `--banner-bottom` are set, for both update-prompt and
  install-prompt (D-32-13).
