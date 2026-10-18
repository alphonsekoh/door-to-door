# #77 · Offline recording screen

- **Status:** Done (PR #100)
- **Phase:** 6 - PWA & Offline
- **Depends on:** #32, #33

## Task

A reload in a dead zone must not stop a member recording. The cold offline fallback
becomes a recording shell for the last signed-in member, built from a local copy of what
the online screens fetched, writing to #33's queue. No contract or schema change.

## Decisions

Owner decisions are marked **(owner)**.

- **D-77-1 · A cold offline launch opens a recording shell built from a local copy.
  Supersedes D-32-17.** _Why:_ the issue; a refresh in a dead zone must not stop
  recording.
- **D-77-2 · The local copy is its own IndexedDB database, `door-to-door-local` (store
  `copy`, key `current`), opened per operation and never the queue's `door-to-door`.**
  _Why:_ clearing it then cannot touch queued records (D-33-1), the queue needs no
  version bump that an older tab would block, and the worker opens neither (D-32-5).
- **D-77-3 · Copy contents (owner, option A).** The member's id and name, the outing,
  and per opened block the `Block` plus the full `HouseholdSummary[]` as the online block
  screen got them (name, contact, religion, latest visit with notes, follow-up count).
  Checked with the generated Zod on read; anything invalid is deleted. _Why:_ the shell
  shows what the online screen shows; one schema with the server; unlike a queued record
  (D-33-8) it is a disposable cache.
- **D-77-4 · Filled from the outing and block screens on success.** A `404` outing
  empties the blocks, another outing resets them, and a block no longer on the outing is
  dropped. A block screen notes the outing too, so a block opened from a link is kept.
  Other errors write nothing. _Why:_ "blocks opened tonight" means this outing's, and the
  shell must not offer a block `/visits/sync` would refuse.
- **D-77-5 · Usable for 12 h from the last write (owner).** Exactly 12 h is usable.
  _Why:_ an evening's outing, inside D-33-9's 24 h, so sent records are still there to
  list.
- **D-77-6 · Cleared on every sign-in and sign-out, and whenever a signed-in page sees
  a member other than the copy's (owner).** `LocalCopyKeeper` in `AppShell` checks and
  clears in one transaction. A failed clear never blocks. _Why:_ covers credentials, SSO
  and an expired session; mirrors D-32-7, D-32-21 and D-74-9.
- **D-77-7 · `/offline` stays prerendered static HTML; all member data is read at
  runtime.** Keeps D-32-4. _Why:_ the precached file is served to whoever holds the
  phone.
- **D-77-8 · The service worker is unchanged; its navigation fallback is the entry
  point.** _Why:_ it already covers every failed navigation, at the address that failed.
- **D-77-9 · "Continue as <name>" gates the form, the queue and the sync bar on every
  cold shell load.** _Why:_ offline, the phone cannot know who is holding it.
- **D-77-10 · On the shell the queue owner is only the member who tapped "Continue as",
  from `shellState`, never the path or the session (owner).** Tapping is enough to list
  that member's unsent records and record new visits under their id, with no server
  confirmation. Sends still ask the cookie (`sendAs`). Refines D-33-1. _Why:_ offline
  the server cannot be asked; the copy is cleared on every sign-in, so "Continue as"
  only ever names the last member who signed in on that phone; every batch still checks
  `/api/auth/session` and the cookie must name the owner (D-33-1), so nothing is sent as
  the wrong member.
- **D-77-11 · Reconnect row: Continue follows what is reachable now.** It appears once
  `/api/auth/session` answers or a record is sent after the last drop, and hides again on
  `offline` or an unanswered probe; answers to probes asked before a drop are ignored.
  Probes run on mount, `online`, focus, visibility and every 30 s. Continue is a `goTo`
  (D-33-28), confirms first if the form has input, and nothing navigates by itself while
  recording. Refines D-33-22: the `online` reload stays only in the no-copy and gate
  states; flushing relies on the queue's own triggers (D-33-19). _Why:_ never navigate
  under someone mid-form, never offer a full load into a dead zone, and
  `navigator.onLine` lies with one bar.
- **D-77-12 · Blocks are in-page state; the bottom nav is hidden and `--nav-height` is
  0 on the shell.** _Why:_ every offline navigation reloads cold and drops the form.
- **D-77-13 · Shell units cannot be tapped, and a record sent after its block's copy
  stays listed, marked "Sent".** Decided by `syncedAt`, not `enqueuedAt`. _Why:_ D-33-13;
  the shell cannot re-read the server, and a record queued before a re-read but sent
  after it is not in that copy.
- **D-77-14 · `overscroll-behavior-y: none` on `html` as well as `body`.** _Why:_
  Chrome on Android hangs pull-to-refresh on the root scroller, and a pull offline is a
  cold reload. _Research:_ R-48.
- **D-77-15 · "N records are saved on this phone" counts every unsent record of the
  owner, held and quarantined included.** Same set as D-33-15, not D-33-14. _Why:_ all of
  them exist only on this phone.
- **D-77-16 · The offline E2E dispatches `online` by hand, and the second member signs
  in to `/account`.** _Why:_ Playwright fires no `online` for a document loaded offline
  (R-47); the outing screen would write the second member's own copy over the first's
  and hide a failed clear.

## Relies on

D-32-4, D-32-5, D-32-7, D-32-15, D-32-18 (WebKit skips the offline E2E), D-32-21,
D-33-1, D-33-8, D-33-9, D-33-12, D-33-13, D-33-15, D-33-19, D-33-21, D-33-25, D-33-28,
D-74-9.

## Inherited by other tasks

- **#34 (offline tests):** the separate `door-to-door-local` store (D-77-2) keeps its
  "unreadable copy deleted" and "never touches the queue" tests; #34 added that a queue
  database missing its store, from a newer build, or closed never takes the page down
  (D-34-7), and the fuzz checks owner scoping across reloads as the owner switches
  (D-34-9, D-77-10).

## Known limits

- The install and update prompts still follow the path and the session, not
  `shellState`. Offline the session reads as signed out (R-44), so neither shows; on a
  shell that has signal again they could.
- Continue can take up to 30 s to appear (or to hide) when no `online`/`offline` event
  fires, as with one bar.
- Real-device checks are for the verifier: Android pull-to-refresh and the Save bar over
  the keyboard; an iPhone cold launch from the home screen, where evicted IndexedDB must
  show the "Nothing is saved" state.

## Open questions

None.
