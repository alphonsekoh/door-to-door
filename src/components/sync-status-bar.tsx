"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";
import { useSyncQueue } from "@/components/sync-provider";
import { useShellState } from "@/lib/offline/shell-state";
import { barSummary, quietText } from "@/lib/sync/sync-ui";
import { isPublicPath } from "@/server/auth/routes";
import { SheetPresence } from "@/components/sheet";

/*
 * Always in view while anything of this member's is unsent, so nobody
 * pockets the phone believing the evening is saved: sticky under any banner
 * and beneath every sheet (z-20). A button, not a live status: the recording
 * form owns that role for "Saved" (D-33-12).
 *
 * Quiet ("All visits sent"), it scrolls away with the page: at large text
 * sizes a bar pinned for good news took a fifth of the screen from the form.
 *
 * Its row is held, one line high, on every signed-in page from the first
 * paint, even with nothing to count and before the queue has opened. The bar
 * turning up mid-form, when a send times out twenty seconds after Save, would
 * push the form down under a thumb already on its way to an interest level;
 * turning up once the session and the queue have loaded would do the same to
 * every page load. Becoming sticky moves nothing: the row is already there.
 */
const ROW =
  "-mx-4 mb-3 flex h-11 w-[calc(100%+2rem)] items-center justify-between gap-3 bg-surface-muted px-4 text-left text-body";

/* Over the page once scrolled: a fade beneath it rather than a hard rule. */
const PINNED = "scroll-edge sticky top-[var(--banner-top,0px)] z-20";

export function SyncStatusBar() {
  const { records, justSaved, enqueue } = useSyncQueue();
  const pathname = usePathname();
  const shell = useShellState();
  const [open, setOpen] = useState(false);
  /* The offline shell shows it once someone is recording, wherever its
     address happens to be. */
  if (shell.active ? shell.ownerId === null : isPublicPath(pathname)) return null;
  /* Empty while there is no queue to speak for: still loading, or none on
     this browser, where the form saves straight to the server. */
  const summary = enqueue === null ? null : barSummary(records, justSaved);

  return (
    <>
      {summary === null ? (
        <p className={`${ROW} text-foreground-muted`}>
          {enqueue === null ? null : (
            <span className="truncate">{quietText(records, justSaved)}</span>
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className={`${ROW} ${PINNED}`}
        >
          <span className="truncate font-medium">{summary.text}</span>
          <span className="shrink-0 text-primary">View</span>
        </button>
      )}
      <SheetPresence>
        {open ? (
          <SyncQueueSheet
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );
}
