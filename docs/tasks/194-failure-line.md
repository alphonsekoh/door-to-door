# #194 · Screens say their own sentence, not the browser's, when a request fails

- **Status:** In progress (branch `fix/194-failure-line`)
- **Phase:** 7 - Hardening
- **Depends on:** #74, #165

## Task

With no answer, `fetch` rejects with a `TypeError` in the browser's words ("Failed to
fetch", "Load failed"), and screens showed any `Error`'s message, so a member who lost
signal read that text. One helper now picks the line every screen shows. Client only: no
contract or schema change.

## Decisions

- **D-194-1 · One helper, `failureLine(error, fallback)`, in its own file,
  `src/lib/failure-line.ts`, not in `api-client.ts`.** _Why:_ tests that replace the
  api-client module (admin-records mocks `{ apiFetch, ApiRequestError }`) would lose a
  helper that lived there.
- **D-194-2 · It shows an `ApiRequestError`'s message, and the screen's own sentence for
  anything else:** a fetch `TypeError` ("Failed to fetch", "Load failed", Firefox's
  "NetworkError …"), a `SyntaxError`, a `DOMException` timeout, any other `Error`, or a
  non-Error. _Why:_ only an `ApiRequestError`'s text was written for the member; the
  rest is the browser's or the engine's. Keeps D-28-3 and D-125-22: a refusal still
  shows the server's sentence. _Research:_ R-36, R-196.
- **D-194-3 · A body outside the envelope still reads "Something went wrong.", not the
  screen's sentence.** Keeps D-165-2. _Why:_ that is the `ApiRequestError`'s own
  message; showing the fallback there would change D-165-2.
- **D-194-4 · It is used at all 30 places that showed a request's failure:** 25 that
  showed any `Error`'s message, and 5 that already did it by hand (account-screen's
  `messageOf`, session-households' `failureText`, member-detail's sign-out line), whose
  logic was the same. Every fallback sentence is unchanged, word for word. _Why:_ one
  rule for every screen. New wording is the owner's (Open questions).
- **D-194-5 · `describeAmendFailure` falls through to `failureLine`, after D-74-43's
  network wording.** A `TypeError` still reads "Could not confirm. Refresh to see
  whether it went through." (D-74-54). Only a non-API error that is not a `TypeError`,
  such as a `SyntaxError`, now reads "Could not save this change." instead of its own
  text. _Why:_ the same rule as every other screen, without touching D-74-43.
- **D-194-6 · The offline banner and the sync queue are unchanged.** The banner says
  "Offline. Records save on this phone."; the queue says "No signal. Sends when you're
  back online." (D-33-20). `transport.ts`'s retry and drop rules (D-33-5, D-165-5) are
  untouched. _Why:_ both already use fixed wording, so no surface shows fetch's text
  now. They still word a lost connection differently from the screens (Open questions).
- **D-194-7 · Server code that never reaches a screen is out of scope:**
  `src/server/config.ts:151` (startup report), `src/server/auth/config.ts:100` (Auth.js
  logger), `src/server/logging/error-log.ts` and `src/server/auth/auth-log.ts`. Screens
  that already show fixed text (team-ui, `describeFollowUpFailure`, auth-failure-screen,
  sign-in-form) were left alone. _Why:_ an `Error`'s message there goes to a log or to
  stderr, for an operator.
- **D-194-8 · A test's refusal is a real `ApiRequestError` with the server's code, and a
  dropped connection is `TypeError("Failed to fetch")` or `TypeError("Load failed")`.**
  They used to throw a plain `Error("<server sentence>")`. _Why:_ `apiFetch` never
  throws a plain `Error`, and under `failureLine` one would read as the fallback, so the
  old doubles no longer tested the server's sentence.

### How existing decisions are handled

| Decision                  | Effect                                                                     | By      |
| ------------------------- | -------------------------------------------------------------------------- | ------- |
| D-165-2                   | Kept; its _Effect_ note now points here for the callers' pattern           | D-194-3 |
| D-74-43, D-74-54          | Kept: amend's network wording comes first                                  | D-194-5 |
| D-33-5, D-33-20, D-165-5  | Kept: the queue's wording, retries and drops are unchanged                 | D-194-6 |
| D-28-3, D-125-22          | Kept: a refusal shows the server's sentence                                | D-194-2 |
| #126 known limit (alerts) | Its browser words are fixed; the alert's timing after an older read is not | D-194-2 |

## Evidence

- With the old pattern put back in the helper, 37 tests fail across 21 files, including
  all 4 of the helper's fallback tests (verifier; the builder saw 23 in 10 files).
- Put back at one call site at a time, 26 of 30 sites are caught; with the server's
  sentence dropped instead, 22 of 30. Every site is guarded in at least one direction.
- On both phones (Pixel 5 on Chromium, iPhone 13 on WebKit), the block, unit, record
  form and admin screens showed their own sentence with no answer, and the server's for
  a refusal (verifier, production build).

## Known limits

- No test fails if the old pattern returns at `block-attach-sheet.tsx` (add a block,
  attach blocks), `session-detail.tsx` (remove a block) or `amend.ts` (no test throws a
  `SyntaxError`). Each is guarded the other way.
- Eight sites have no test that the server's sentence comes through: account-screen's
  save, admin-records, member-list, block-attach-sheet's load, attention-list,
  consolidated-history (two) and session-records. Each is guarded against the browser's
  words.
- Already on `main`, admins only, only the text changed: a failed Start, End or Reopen
  on the Sessions list can land under the nav (`session-action-button.tsx`), and a
  failed role change on Team is said above the list, off screen (`member-list.tsx`). The
  verifier suggests a separate issue.
- Playwright cannot run an iPhone with the service worker in charge offline (D-32-18).
  One look on a real iPhone is worth it: open a block, turn on airplane mode, then wait
  for a sync re-read.

## Relies on

D-28-3, D-32-18, D-33-5, D-33-20, D-74-43, D-74-54, D-125-22, D-165-2, D-165-5.

## Open questions

- Should a load that gets no answer say "You seem to be offline.", as the team screens
  do (D-74-43), rather than "Could not load …"? The same cause now reads several ways:
  the banner, the queue, the team screens and the other screens each word it their own.
- Should D-74-43's change wording ("Could not confirm. Refresh to see whether it went
  through.") apply to the other change screens? They say "Could not save …" with no
  answer, though a lost reply may have saved (R-36).
