# #129 · Nothing of the last member after sign-out (with #130)

- **Status:** In review (PR #161)
- **Phase:** 7 - Hardening
- **Depends on:** #29, #30, #33, #74, #77, #122, #150

## Task

Two audit issues in one PR. #129: Back after sign-out could bring the last member's screen
back from the back/forward cache on an engine that ignores `no-store`, and `/offline` is
never `no-store`. #130: the history and records search term went into the query string,
sent records stayed on the phone for 24 h after sign-out, an expired local copy was never
deleted, and the CSV guard missed a leading CR.

## Decisions

### Back after sign-out (#129)

- **D-129-1 · Every document reloads when the browser restores it from the back/forward
  cache, hidden first.** `reloadWhenRestored` (`src/lib/session/navigate.ts`) runs through
  `RestoreGuard` in `AppShell`, outside `AccountGate`, so signed-in pages, the account
  message, `/offline` and `/sign-in` all reload. It is a reload, not a re-check that clears
  the screen. Refines D-74-11, whose `no-store` is no longer the only guard; keeps D-122-10
  and D-150-1 to D-150-4; `/offline`'s `s-maxage` stays with #146. _Why:_ `no-store` keeps
  a page out of that cache only where the engine honours it (unverified on WebKit), and
  `/offline` is never `no-store`; a reload puts every screen back behind the proxy by one
  path. Hidden, so a slow reload never shows the old screen. _Trade-off:_ a restored page
  loses unsaved input, an offline shell restored mid-recording included. That refines
  D-77-11 and D-33-22: a restore follows the member leaving the page, so it is not a
  navigation under them. _Research:_ R-31, R-136.
- **D-129-2 · The "leaving on purpose" flag is never cleared.** `pageshow` no longer
  resets it, and the guard's reload goes through `reloadPage`. Refines D-33-28, whose "a
  page restored from the back/forward cache must warn again" no longer applies: that page
  is reloaded, never used again. _Why:_ the reset would raise "Leave site?" over the old
  screen during the guard's reload.
- **D-129-3 · Sign-out replaces its page in history.**
  `signOutAndForget(signOut, memberId, destination = "/sign-in", navigate = replaceWith)`;
  `replaceWith` marks the departure and calls `location.replace`, and callers no longer
  pass a navigation. Refines D-74-10, as #129 asks: `assign` becomes `replace`, and
  `redirect: false` and the relative path stand. Sign-in still leaves with `goTo`
  (D-15-7). _Why:_ Back from sign-in then reaches the screen before Account, which the
  proxy sends to sign-in, never the account or failure screen; and no caller can bring a
  push back.
- **D-129-4 · Sign-out confirms the session has gone before it leaves.** After Auth.js
  answers, it asks `/api/auth/session` (no-store, 5 s) and signs out again while the answer
  names someone, at most 3 sign-outs in all. Past that it fails like a refused sign-out and
  stays put (extends D-74-64). An unanswered check lets the sign-out stand. _Why:_ an
  answer to a request sent before the sign-out and delivered after it sets the session
  cookie again (R-137). The check only confirms a sign-out that succeeded, so it waits less
  than a send's 20 s (D-33-5).
- **D-129-5 · `/sign-in` looks once more after a sign-out.** Sign-out leaves the
  sessionStorage note `d2d:just-signed-out`. The sign-in form's `finishSignOut` checks once
  on arrival, signs out again as D-129-4 does, and drops the note whatever the outcome; a
  sign-in waits for it. If the session will not go, the form says "You may still be signed
  in on this phone. Check your connection, then sign in and sign out again." instead of
  "You were signed out". Storage that cannot be used skips the look. _Why:_ the page that
  signed out lives until `/sign-in` replaces it, and an answer can land meanwhile (R-137).
  Waiting keeps that sign-out from landing after the new sign-in; looking only once means
  a later visit cannot sign the next member out.

### What stays on the phone (#130)

- **D-129-6 · Sign-out deletes the signing-out member's sent queue records; sign-in
  deletes none (owner, 2026-11-04).** `forgetSentRecords(memberId)`
  (`src/lib/sync/forget-sent.ts`) goes through `SyncQueue.deleteSentBy` over the
  `by-owner` index. The member is the page's `useRole().userId`; undefined deletes
  nothing. Another member's sent records keep D-33-9's 24 h, and unsent, held,
  quarantined and corrupt records stay, whoever saved them. Bounded by `CLEAR_WITHIN_MS`
  (1.5 s) like the cache clear, and a failure never blocks (mirrors D-77-6, D-111-68).
  Refines D-33-1, D-33-2 and D-33-9. _Rejected (owner):_ every sent record, whoever
  saved it, at every sign-in and sign-out, as first built; it took another member's
  records at someone else's sign-out, against D-33-1. _Why:_ a sent record is on the
  server and still holds a name, a contact and notes, so it leaves with its member, as
  #130 asks; at sign-in the member before is not known. D-77-13 is unaffected: a kept
  sent record is another member's, never listed (D-33-1), or the member's own, judged by
  `syncedAt` as before. _Known limit:_ a send that finishes during sign-out keeps its row
  until the 24 h purge or that member's next sign-out.
- **D-129-7 · The history and records search term lives only in component state.**
  `history-filters` and `record-filters` never read or write `q`, the two screens hold it,
  and `setFilter` cannot take it. Clear filters empties it, export applies it, and an old
  `?q=` is ignored, not stripped. Not the hash either. Refines D-29-4 (the search term is
  the exception); keeps D-29-5 and D-30-6. _Why:_ a query string reaches the server, its
  logs, the phone's history and a sign-in's `callbackUrl` on every keystroke, and a hash
  still sits in the phone's history; the search is client-side, so nothing needs it in the
  URL. _Trade-off:_ the term is lost on reload or Back from a household and is not in a
  shared link. Typing no longer refetches. `session-records.tsx`, which #130 cites, holds
  only the Me / My team scope and is unchanged.
- **D-129-8 · An expired local copy is deleted when it is read.** `loadLocalCopy(now)`
  deletes a copy past 12 h in the same transaction as an unreadable one, and `copyExpired`
  is shared with `usableCopy`. Writes are left to #126. Refines D-77-3 and D-77-5 (exactly
  12 h is still usable). _Why:_ nothing can record with it again, and it still names
  households and their contacts.
- **D-129-9 · The CSV guard also prefixes a value that starts with tab or CR, or whose
  first `= + - @` follows only whitespace, control (`Cc`) or format (`Cf`) characters.**
  Quoting is unchanged. Refines D-30-4. _Why:_ some spreadsheets take a leading CR as a
  formula start, others skip leading whitespace and invisible characters first, and member
  text reaches the export as typed. _Known limit:_ a formula after a `;` mid-cell, in a
  locale whose separator is `;` (#163). _Research:_ R-29, R-139.

### Tests

- **D-129-10 · E2E checks Back after sign-out by its `callbackUrl`, on both phone
  projects.** `account.spec`'s old sign-out test is replaced by a member test (History,
  Account, Sign out, Back) and an admin test (`/admin/team`, Account, Sign out, Back). Each
  lands on `/sign-in?callbackUrl=` the screen before Account, which a pushed sign-out would
  make `%2Faccount`. A third holds a session answer until the sign-out is answered, with
  the worker blocked. `pwa.spec`'s shared-phone test expects the member's sent record gone
  at her sign-out and her unsent one kept, and stops sends with `context().route`. _Why:_
  neither Playwright engine reaches a real restore here (R-136), so the restore itself
  rests on Vitest and the owner's iPhone check; `page.route` misses what the worker
  fetches (R-138).

### How existing decisions are handled

| Decision               | Effect                                                                    | By      |
| ---------------------- | ------------------------------------------------------------------------- | ------- |
| D-74-10                | Refined: `location.replace`, not `assign`, as #129 asks                   | D-129-3 |
| D-74-11                | Refined: a page restored anyway is hidden and reloaded                    | D-129-1 |
| D-74-64                | Extended: a session that keeps coming back fails the same way             | D-129-4 |
| D-33-28                | Refined: `pageshow` no longer clears the flag                             | D-129-2 |
| D-77-11, D-33-22       | Refined: a restored shell reloads, even while recording                   | D-129-1 |
| D-33-1, D-33-2, D-33-9 | Refined: a member's sent records go at their sign-out; none at sign-in    | D-129-6 |
| D-29-4                 | Refined: the search term is never in the URL                              | D-129-7 |
| D-77-3, D-77-5         | Refined: a copy past 12 h is deleted when read                            | D-129-8 |
| D-30-4                 | Refined: tab, CR, and a sign behind leading whitespace or invisible chars | D-129-9 |
| D-122-10               | Kept as worded: the probe that seemed to contradict it proves nothing     | R-136   |
| R-31                   | Updated: a WebKit restore is still unverified                             | D-129-1 |

## Known limits

- An answer the service worker is still fetching after `/sign-in` has looked can put the
  session cookie back (verifier, Chromium 2 of 2; not reachable in Playwright WebKit;
  R-137). Accepted by the owner for this PR on 2026-11-04 and tracked in #162; D-83-15(b)
  stands as worded.
- D-129-6: a tab still showing member A while the cookie is already B's deletes A's sent
  records at its sign-out, not B's. Rare, since next-auth refetches the session on focus,
  and nothing unsent is at risk.
- D-129-6: a member who never signs out leaves their sent records on the phone for up to
  24 h, hidden from the next member (D-33-1).
- The iOS swipe-back preview is a snapshot the system takes, which no script can blank.
- An old `?q=` link stays in the address bar until a filter changes, so a session that
  lapses on that page still carries it into `callbackUrl` (#163).
- No E2E test guards `/sign-in`'s second look on its own; Vitest does.
- Older than this PR, seen by its verifier: after a failed sign-out, Sign out sits under
  the bottom nav on iPhone 13 (#164); `ApiRequestError` throws on a JSON error body
  without the `{ error }` envelope (#165).

## Owner checks (real iPhone over HTTPS; not claimed by the PR)

The owner kept `Closes #129` (2026-11-04), so merging closes #129 whether or not this
check has been done.

In a Safari tab and in the home-screen app: sign out from Account after History, and after
an admin screen; press Back, and swipe back slowly. Expect the sign-in screen. Also switch
apps mid-form and come back: the form must keep what was typed, since a persisted
`pageshow` there would reload it.

## Relies on

D-15-6, D-15-7, D-29-5, D-30-6, D-32-18, D-33-5, D-33-8, D-33-14, D-33-15, D-33-23, D-74-9,
D-74-12, D-77-6, D-77-9, D-77-13, D-83-15, D-111-68, D-122-10, D-150-1 to D-150-4.

## Open questions

None. The owner ruled on 2026-11-04: the worker's late answer is a known limit (#162),
and D-129-6 was narrowed to the signing-out member's sent records, none at sign-in.
