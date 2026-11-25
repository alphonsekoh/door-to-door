"use client";

import { InterestChip } from "@/components/ui/interest-chip";
import { useSyncQueue } from "@/components/sync/sync-provider";
import { canRetry } from "@/lib/sync/classify";
import { isCorrupt, isErased } from "@/lib/sync/record";
import {
  QUEUE_NOTE,
  blockReason,
  deleteNote,
  queueTitle,
  recordReason,
  stateLabel,
} from "@/lib/sync/sync-ui";
import { Sheet, SheetActions, SheetPresence } from "@/components/ui/sheet";
import { formatDayTime } from "@/lib/history/dates";
import { UnitNumber } from "@/components/ui/unit-number";

/* The sheet with its way out, as the one piece the sync bar loads when it
   is first tapped. */
export function SyncQueuePresence({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SheetPresence>{open ? <SyncQueueSheet onClose={onClose} /> : null}</SheetPresence>;
}

/*
 * Every record of this member's not yet on the server, and the one thing
 * they can do about any of them: retry (D-33-2). There is no discard, here
 * or anywhere: an unsent record is a knock nobody else has seen.
 */
export function SyncQueueSheet({ onClose }: { onClose: () => void }) {
  const { records, inFlight, block, retry, retryAll } = useSyncQueue();
  const unsent = records.filter((record) => record.state !== "synced");
  /* Erased stubs stay listed for the day they are kept, so the member can read why. */
  const shown = records.filter((record) => record.state !== "synced" || isErased(record));
  const why = blockReason(block);
  const title = queueTitle(shown);
  /* With no signal Retry all cannot succeed, so it is not the loud action;
     it stays available, because one bar can read as none. */
  const offline = block?.reason === "offline";

  return (
    <Sheet label={title} title={title} closeLabel="Close" onClose={onClose}>
      <p className="mt-2 text-caption text-foreground-muted">{QUEUE_NOTE}</p>
      {why === null ? null : (
        <p className="mt-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-body">
          {why}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="mt-4 text-body text-foreground-muted">Everything has been sent.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          {shown.map((record) => {
            const reason = recordReason(record);
            const deletion = deleteNote(record);
            const sending = inFlight.has(record.id);
            return (
              <li
                key={record.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 last:border-b-0"
              >
                {/* At large text Retry drops under the record rather than
                    squeeze what it says to a few words a line. */}
                <span className="min-w-0 flex-[1_1_12ch]">
                  {isCorrupt(record) ? (
                    <span className="block text-body font-semibold">Unreadable record</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-body font-semibold tabular-nums">
                        <UnitNumber value={record.item.unitNumber} />
                      </span>
                      <InterestChip level={record.item.interestLevel} />
                    </span>
                  )}
                  <span className="block text-caption text-foreground-muted">
                    {stateLabel(record, inFlight)} · saved {formatDayTime(record.enqueuedAt)}
                  </span>
                  {reason === null ? null : <span className="block text-caption">{reason}</span>}
                  {deletion === null ? null : (
                    <span className="block text-caption text-foreground-muted">{deletion}</span>
                  )}
                </span>
                {sending || !canRetry(record) ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      retry(record.id);
                    }}
                    aria-label={`Retry ${record.item.unitNumber}`}
                    className="ml-auto min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
                  >
                    Retry
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SheetActions>
        <button
          type="button"
          disabled={!unsent.some(canRetry)}
          onClick={retryAll}
          className={`${offline ? "btn-secondary" : "btn-primary"} min-h-14 w-full rounded-xl text-title font-semibold`}
        >
          Retry all
        </button>
      </SheetActions>
    </Sheet>
  );
}
