"use client";

import { createPortal } from "react-dom";
import { InterestChip } from "@/components/interest-chip";
import { useSyncQueue } from "@/components/sync-provider";
import { canRetry } from "@/lib/sync/classify";
import { isCorrupt } from "@/lib/sync/record";
import { QUEUE_NOTE, blockReason, recordReason, stateLabel } from "@/lib/sync/sync-ui";
import { useModal } from "@/lib/use-modal";

const savedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/*
 * Every record of this member's not yet on the server, and the one thing
 * they can do about any of them: retry (D-33-2). There is no discard, here
 * or anywhere: an unsent record is a knock nobody else has seen.
 */
export function SyncQueueSheet({ onClose }: { onClose: () => void }) {
  const { records, inFlight, block, retry, retryAll } = useSyncQueue();
  const { overlay, panel } = useModal(onClose);
  const unsent = records.filter((record) => record.state !== "synced");
  const why = blockReason(block);

  return createPortal(
    <div ref={overlay} className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />

      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Records not sent"
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-title font-semibold">Records not sent</p>
          <button type="button" onClick={onClose} className="min-h-11 text-body text-primary">
            Close
          </button>
        </div>

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
                      {stateLabel(record, inFlight)} · saved {savedAt.format(record.enqueuedAt)}
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
                      className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium"
                    >
                      Retry
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 bg-background/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            disabled={!unsent.some(canRetry)}
            onClick={retryAll}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            Retry all
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
