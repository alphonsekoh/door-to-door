# #33 · IndexedDB write queue and sync engine

- **Status:** Open
- **Phase:** 6 - PWA & Offline
- **Depends on:** #21, #32

## Task

Write to IndexedDB first, then sync; never lose a record to a dead spot.

## Decisions

None yet. The issue specifies: `idb`; flush on `online`, focus and Background Sync;
exponential backoff; poison items quarantined; engine as pure functions over a queue
interface.

## Relies on

D-07-3, D-21-1 to D-21-7, D-25-7, D-26-5 (only changed fields, which keeps
`updatedAt` honest for last-write-wins), D-32-5 (the service worker never touches
IndexedDB; the queue owns it), D-32-6 (updates defer while items are unsynced),
D-76-3 to D-76-7 (clock rules).

Findings from #32 that shape the design (R-19, R-20):

- iOS may evict IndexedDB after about 7 days of non-use (unverified), and there is no
  Background Sync on iOS. Flush on `online`, focus and app start; do not rely on
  Background Sync. Show unsynced state so a member knows to open the app.

## Inherited

Two acceptance criteria from #26: queued units appear in the unit list and look
distinct.

From #32: replace the `hasUnsyncedItems()` stub in `src/lib/sw-update.ts` (returns
false) with a real queue check. The update prompt already calls it and defers while it
is true (D-32-6). Sign-out already clears the caches (D-74-9) and warns when `hasUnsyncedItems()` is
true, so the warning only becomes real once this task replaces the stub.

From #76 (clock rules): send `sentAt` (the phone's clock, regenerated) on every attempt;
handle batch `422 clock_skew` (keep everything queued, tell the member to fix the clock)
and item `clock_skew` (restamp, then retry, throttled); probe clock-blocked records at
most every 5 minutes, since the limiter counts 422s (D-76-7); always send the visit's own
`sessionId`, including on amends (D-76 known limit).
