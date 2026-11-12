# #163 · CSV `;` guard, and an old `?q=` dropped on load

- **Status:** Done (PR #170)
- **Phase:** 7 - Hardening
- **Depends on:** #16, #29, #30, #129 (with #130)

## Task

Two items PR #161 left open from #130. A spreadsheet reading the export with `;` as its
separator split a value at its `;`, so a formula could start mid-value. And a bookmarked
or shared link with `?q=` kept a search term, a name or a phone number, in the address
bar, from where a lapsed session carried it into `/sign-in?callbackUrl=`.

## Decisions

### The export read with `;` as the separator

- **D-163-1 · Each `;`, CR or LF inside a value that leads to `= + - @`, or straight to a
  tab, gets a `'` of its own after it.** Whitespace, `Cc`, `Cf` and `"` are skipped on
  the way to the sign, but never a line break. Every column; the cell-start rule and
  quoting are unchanged. A leading CR or LF before a sign now gets two: `\r=HYPERLINK(…)`
  exports as `"'\r'=HYPERLINK(…)"`, `\n-1` as `"'\n'-1"`. Refines D-30-4 and D-129-9, as
  #163 asks, and closes D-129-9's known limit. _Why:_ a `;` reader honours a `"` only
  where it opens one of its own fields, which none of ours past a row's first does, so it
  starts a field after every `;` and a row at every line break inside a value. It
  unwraps a `"` that opens such a field, so that is skipped. Without the line-break
  guard, `Tan\n=HYPERLINK(...);` would run. _Research:_ R-139, R-143.
- **D-163-2 · A `,` inside a value gets no guard.** _Why:_ a value holding one is quoted,
  so a comma reader keeps it in the cell, and to a `;` reader it is not a separator.
  `9123 4567, +65 8123 4567` round-trips unchanged. _Research:_ R-143.
- **D-163-3 · No `sep=` line.** _Why:_ only some spreadsheets read it as a hint; to
  others, and to a script, it is a first row of data. The guard has to hold whichever
  separator the reader picks.
- **D-163-4 · The cost: a visible `'` mid-cell for a comma reader (pending the owner).**
  Any line, or part after a `;`, that starts with a sign shows its `'` in an ordinary
  import. A dash-bullet note exports as `"Notes\n'- one\n'- two"`, a second number as
  `9123 4567;' +65 8123 4567`, a `+65` number on its own line in notes gains one, and so
  does a teammate whose name starts with a sign, after the `; ` of D-74-59. Text with
  `;` or `,` and no sign after it round-trips unchanged. _Why:_ the price of D-163-1's
  line-break guard. See Open questions.

### An old `?q=` link

- **D-163-5 · An old `?q=` fills the search and leaves the address on load, with no
  reload.** `useSearchTerm` (`src/lib/hooks/use-search-term.ts`) holds the term for
  `/admin/history` (All records) and `/admin/records`. The new address keeps only the
  recognised filters, so an unknown parameter on such a link goes too. Refines D-129-7
  (an old `?q=` was ignored, not stripped) and D-29-4, as #163 asks. The screens still
  never write the term, and D-129-7's trade-off stands: it is lost on reload or Back
  from a household. _Why:_ left in the address, it sat in the phone's history and rode
  into `callbackUrl`. The address is rebuilt from the validated filters D-29-4 reads.
- **D-163-6 · The strip goes through the History API, not `router.replace` as the issue
  proposed.** A native `history.replaceState(history.state, "", href)` in a layout
  effect, so it lands before the screen's own requests, keeps Next's state in the entry;
  Next's own patched `replaceState(null, "", href)`, in a `setTimeout`, then moves
  `useSearchParams`. Leaving the screen first cancels it. No router call is made, so the
  builder's first `{ scroll: false }` is gone.
  _Why:_ `router.replace` moves the address only once the server answers, so the term
  stayed in the address and in the `Referer` of the first load's API calls, and a failed
  round trip reloaded the page with the search empty, or showed Offline (R-140).
  _Trade-off:_ it leans on Next 16 internals, the `__NA` entry state and the patch its
  router installs in an effect (R-141). Vitest models them by hand.
- **D-163-7 · A `q` that appears while the screen is open is taken too, replacing what
  was typed.** Back or Forward onto an older entry with `?q=`, or a pushed `?q=`, fills
  the search and is stripped the same way. _Why:_ it is the same old link; left alone it
  puts the term back in the address.
- **D-163-8 · The sign-in redirect drops `q` from `callbackUrl` on every path.**
  `signInRedirect` (`src/server/auth/routes.ts`) deletes every `q`. A query without one
  passes byte for byte; with one, the rest is re-serialised. The term is lost after
  signing in: the screen opens with its filters and an empty search. Refines D-16-1.
  _Why:_ a signed-out open of an old link never mounts the screen, so only the proxy can
  keep the term out of `/sign-in?callbackUrl=`, and no page reads `q` for anything else.
  An untouched query is not re-encoded, which could change what the page reads back.
- **D-163-9 · "No request carries it" covers request URLs, the screen's own requests and
  `callbackUrl`.** Measured on both phones: no API request URL, none of the screen's
  requests (URL or headers), no request after the strip (any header) and no
  `callbackUrl` carries the term. The document request always does, being the link; the
  shell's first-load `Referer` is a known limit below. The issue's `/history?q=` is read
  as `/admin/history`: the member's `/history` has no search, never read `q`, and is
  unchanged. _Why:_ what a client-side strip can promise.

### How existing decisions are handled

| Decision   | Effect                                                                | By                 |
| ---------- | --------------------------------------------------------------------- | ------------------ |
| D-30-4     | Refined: a sign after a `;` or line break inside a value is defused   | D-163-1 to D-163-3 |
| D-129-9    | Refined as above; known limit closed; a leading CR or LF now gets two | D-163-1            |
| D-29-4     | Refined: an old `?q=` is taken; the strip keeps recognised filters    | D-163-5            |
| D-129-7    | Refined: an old `?q=` fills the search and is stripped, not ignored   | D-163-5 to D-163-7 |
| D-16-1     | Refined: `callbackUrl` never carries `q`                              | D-163-8            |
| D-74-59    | Kept: teammates joined with `; ` are guarded by D-163-1               | D-163-1            |
| D-122-6    | Kept: `Referrer-Policy: same-origin` unchanged (known limit)          | D-163-9            |
| D-32-4     | Kept: the Offline fallback leaves an old link's `q` (known limit)     | D-163-5            |
| #129 limit | Closed: an old `?q=` link and `callbackUrl`                           | D-163-5, D-163-8   |
| R-139      | Updated: names quotes too, and used by D-163-1                        | D-163-1            |

## Known limits

- The shell's first-load requests carry the term in `Referer`: `/api/auth/session`, the
  bottom nav's prefetches, the HTML's static chunks and, on WebKit, the manifest. They
  leave before the screen inside `<Suspense>` hydrates (R-142), under
  `Referrer-Policy: same-origin` (D-122-6). They reach the server that just received the
  term in the document URL, so no new party learns it. The only full fix is app-wide
  (`strict-origin-when-cross-origin` or `no-referrer`); not taken.
- An old link opened with no signal keeps `?q=`. The worker serves Offline at the failed
  address (D-32-4), the screen never mounts, and `q` stays in the address bar and that
  history entry until the page loads online. Nothing reaches the server.
- A Next upgrade can break D-163-6 while Vitest stays green (R-141). Turning its layout
  effect into a plain effect fails no test either; that only adds the term to more
  same-origin `Referer`s.
- D-163-1 leaves a tab after a `"` mid-value (`Tan;"\tcmd`) unguarded, though a `;`
  reader unwraps that quote. A field starting with CR needs a user-typed last column
  ending in `;` before the row's CRLF; `historyToCsv`'s last column is the server-made
  `createdAt`.
- D-163-1 rests on a model of a `;` reader (R-143), not a spreadsheet set to `;`.

## Owner checks (not claimed by the PR)

Open an export holding `Tan;=HYPERLINK(...)` and a multi-line note with a `- ` line in a
spreadsheet set to `;` as its separator: nothing runs, and the `'` shows where D-163-4
says.

## Relies on

D-15-6, D-29-5, D-30-6, D-32-4, D-74-55, D-74-59, D-122-6, D-129-7, D-129-9.

## Open questions

- **D-163-4: is a visible `'` in a comma import an acceptable cost?** It is needed: a
  `;` reader starts a row at a line break in any cell but the first, so without it
  `Tan\n=HYPERLINK(...);` would run. But comma-locale admins will see `'` before dash
  bullets and before a second number (`9123 4567;' +65 8123 4567`). The issue asks that
  the export "still round-trips ordinary text"; the builder read that as text with no
  sign after a `;` or line break. Narrowing the guard to `;` alone would leave a
  formula on a later line runnable.
