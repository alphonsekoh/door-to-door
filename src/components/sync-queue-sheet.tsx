"use client";

import { InterestChip } from "@/components/interest-chip";
import { useSyncQueue } from "@/components/sync-provider";
import { canRetry } from "@/lib/sync/classify";
import { isCorrupt } from "@/lib/sync/record";
import { QUEUE_NOTE, blockReason, queueTitle, recordReason, stateLabel } from "@/lib/sync/sync-ui";
import { Sheet, SheetActions } from "@/components/sheet";
import { formatDayTime } from "@/lib/dates";

/*
 * Every record of this member's not yet on the server, and the one thing
 * they can do about any of them: retry (D-33-2). There is no discard, here
 * or anywhere: an unsent record is a knock nobody else has seen.
 */
export function SyncQueueSheet({ onClose }: { onClose: () => void }) {
  const { records, inFlight, block, retry, retryAll } = useSyncQueue();
  const unsent = records.filter((record) => record.state !== "synced");
  const why = blockReason(block);
  const title = queueTitle(unsent);
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

      {unsent.length === 0 ? (
        <p className="mt-4 text-body text-foreground-muted">Everything has been sent.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          {unsent.map((record) => {
            const reason = recordReason(record);
            const sending = inFlight.has(record.id);
            return (
              <li
                key={record.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  {isCorrupt(record) ? (
                    <span className="block text-body font-semibold">Unreadable record</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-body font-semibold tabular-nums">
                        {record.item.unitNumber}
                      </span>
                      <InterestChip level={record.item.interestLevel} />
                    </span>
                  )}
                  <span className="block text-caption text-foreground-muted">
                    {stateLabel(record, inFlight)} · saved {formatDayTime(record.enqueuedAt)}
                  </span>
                  {reason === null ? null : <span className="block text-caption">{reason}</span>}
                </span>
                {sending || !canRetry(record) ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      retry(record.id);
                    }}
                    aria-label={`Retry ${record.item.unitNumber}`}
                    className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
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
