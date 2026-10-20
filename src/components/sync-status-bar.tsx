"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncQueue } from "@/components/sync-provider";
import { type SyncQueueView, loadSyncQueue } from "@/components/sync-queue-loader";
import { useShellState } from "@/lib/offline/shell-state";
import { barSummary, quietText } from "@/lib/sync/sync-ui";
import { whenIdle } from "@/lib/when-idle";
import { isPublicPath } from "@/server/auth/routes";

/*
 * Always in view while anything of this member's is unsent, so nobody
 * pockets the phone believing the evening is saved: pinned under any banner
 * and beneath every sheet. A button, not a live status: the recording form
 * owns that role for "Saved" (D-33-12).
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
 *
 * Large text on a phone is the exception (globals.css). There the quiet row
 * is not held, so the recording form's unit number is in view as the screen
 * opens, and the count is set at caption size so it stays whole; beside a
 * docked Save it is pinned only while the three leave half the screen. The
 * count wraps rather than being cut short.
 */
const ROW =
  "-mx-4 flex w-[calc(100%+--spacing(8))] items-center gap-x-3 bg-surface-muted px-4 text-left";

/* Over the page once scrolled: a fade beneath it rather than a hard rule. */
const PINNED = "scroll-edge sync-pinned";

export function SyncStatusBar() {
  const { records, justSaved, enqueue } = useSyncQueue();
  const pathname = usePathname();
  const shell = useShellState();
  /* The offline shell shows it once someone is recording, wherever its
     address happens to be. */
  const hidden = shell.active ? shell.ownerId === null : isPublicPath(pathname);
  const [Queue, setQueue] = useState<SyncQueueView | null>(null);
  const [open, setOpen] = useState(false);
  /* A tap found the list could not be fetched; cleared once it can be. */
  const [unavailable, setUnavailable] = useState(false);
  const loading = useRef<Promise<boolean> | null>(null);

  /* A failed fetch is forgotten, so the next attempt goes back out for it:
     never a cached failure, and never an error that takes the page down. */
  const load = useCallback((): Promise<boolean> => {
    loading.current ??= loadSyncQueue().then(
      (view) => {
        setQueue(() => view);
        setUnavailable(false);
        return true;
      },
      () => {
        loading.current = null;
        return false;
      },
    );
    return loading.current;
  }, []);

  /*
   * Fetched as soon as the page is idle, while it most likely still has
   * signal, rather than on the first tap, which comes when it most likely
   * has none. A worker that controls the page would serve the chunk offline,
   * but one is not always in charge: not on the first visit after it
   * installs, nor once Safari has cleared it.
   */
  useEffect(() => {
    if (hidden || Queue !== null) return;
    const retry = () => {
      void load();
    };
    const cancel = whenIdle(retry);
    window.addEventListener("online", retry);
    return () => {
      cancel();
      window.removeEventListener("online", retry);
    };
  }, [hidden, Queue, load]);

  if (hidden) return null;
  /* Empty while there is no queue to speak for: still loading, or none on
     this browser, where the form saves straight to the server. */
  const summary = enqueue === null ? null : barSummary(records, justSaved);

  return (
    <>
      {summary === null ? (
        <p className={`${ROW} held-row text-body text-foreground-muted`}>
          {enqueue === null ? null : (
            <span className="truncate">{quietText(records, justSaved)}</span>
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (Queue !== null) {
              setOpen(true);
              return;
            }
            void load().then((loaded) => {
              if (loaded) setOpen(true);
              else setUnavailable(true);
            });
          }}
          className={`${ROW} ${PINNED} mb-3 control-compact flex-wrap py-1`}
        >
          <span className="min-w-0 flex-[1_1_12ch] font-medium">{summary.text}</span>
          <span className="ml-auto shrink-0 text-primary">
            {unavailable ? "Try again" : "View"}
          </span>
        </button>
      )}
      {Queue === null ? null : (
        <Queue
          open={open}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
