# #192 · Four block-screen tests read state before it lands

- **Status:** In progress (branch `test/192-block-screen-waits`, not yet a PR)
- **Phase:** 7 - Hardening
- **Depends on:** #186, #160

## Task

Four tests in `src/components/blocks/block-screen.test.tsx` failed now and then under
load and passed on a rerun. These are the four left in #186's known limits. Each was
traced to its cause and made to wait for what it asserts. Test only. Built in commit
d07f94a.

## Decisions

- **D-192-1 · Each test waits for the state it asserts, and its assertions stay the
  same.** The alert's text and the follow-up chips are wrapped in `waitFor`, and the
  re-read's tab is a `findByRole`. Nothing is retried, slept or given a longer timeout.
  _Why:_ three of them read state that is drawn in a transition (D-155-2), after the
  event they awaited, and a busy runner draws it later. This applies D-88-4.
- **D-192-2 · "Shows the units that arrived when a later page drops on first open"
  searches only the "Block views" tablist, with findBy's default 1 s limit.** _Why:_ that
  test did wait. A role query over the whole page, with 100 rows open, was slow enough
  under load to hold up the render it was waiting for until the 1 s limit ran out. A
  longer limit would only move the line. _Research:_ R-195.
- **D-192-3 · The app is not changed.** _Why:_ the late draws are D-155-2's transitions
  working as meant. The tests read too soon.

## Causes

The builder confirmed each cause. Two differ from the issue's guess.

- **"Saves a unit an admin added since the list was read":** the chips come from the
  follow-up list. Before posting, the save reads that list again through `recheck`
  (`record-visit-form.tsx:421`, D-117-18). The list is drawn in a transition after the
  POST goes out. The chips do not come from the units read after the save, as the issue
  guessed.
- **"Shows the units that arrived when a later page drops on first open":** this test
  did wait. Under load each whole-page poll took up to about 250 ms, and the render it
  waited for came after the 1 s limit (R-195). The issue guessed it did not wait.
- **"Never takes away a unit shown because a later read got less":** the first read's
  alert stays up until the new read lands (D-126-10). `findByRole` found it, and its text
  was then checked only once.
- **"Re-reads the units once a queued record reaches the server, and not before":** once
  a record is sent, it is no longer laid over the units (D-33-21). Until the re-read
  lands, which happens after its request, the tab says one.

## Evidence

- **Before:** two batches of runs under load, with each failing test as it is on main
  (builder). 1 of 40 failed ("never takes away"), then 1 of 48 ("shows the units that
  arrived").
- **Bite:** the app was broken once for each of the four tests, and each test failed at
  its new wait. The app was restored after each run (builder). The reviewer (r0) repeated
  this in a scratch copy.
- **After:** the file passed 60 of 60 runs under load, 20 of them beside a full
  `npm test` (builder). It also passed 5 of 5 runs (reviewer r0).

## Relies on

D-155-2, D-88-4, D-126-10, D-117-18, D-33-21, D-186-1.

## Open questions

- **Owner:** should D-192-2 become a test rule in CLAUDE.md's Tests section? Proposed
  wording: on a screen with a long list, search only the smallest container that holds
  the element, and never raise the timeout. It would be a `[convention]`. No lint rule
  enforces it.
