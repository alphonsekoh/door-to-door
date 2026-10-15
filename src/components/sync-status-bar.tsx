"use client";

import { useState } from "react";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";
import { useSyncQueue } from "@/components/sync-provider";
import { barSummary } from "@/lib/sync/sync-ui";

/*
 * Always in view while anything of this member's is unsent, so nobody
 * pockets the phone believing the evening is saved. Sticky under any banner
 * and beneath every sheet (z-20). A button, not a live status: the
 * recording form owns that role for "Saved" (D-33-12).
 */
export function SyncStatusBar() {
  const { records, justSaved } = useSyncQueue();
  const [open, setOpen] = useState(false);
  const summary = barSummary(records, justSaved);

  return (
    <>
      {summary === null ? null : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="sticky top-[var(--banner-top,0px)] z-20 -mx-4 mb-3 flex min-h-11 w-[calc(100%+2rem)] items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 text-left text-body"
        >
          <span className="font-medium">{summary.text}</span>
          <span className="text-primary">View</span>
        </button>
      )}
      {open ? (
        <SyncQueueSheet
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
