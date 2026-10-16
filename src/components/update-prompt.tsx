"use client";

import { useEffect, useRef, useState } from "react";
import { useReservedSpace } from "@/components/use-reserved-space";
import { reloadPage } from "@/lib/navigate";
import { activateWaitingWorker, watchForWaitingWorker } from "@/lib/sw-update";

type Props = {
  /* Whether the signed-in member still has records being sent (#33). */
  hasUnsynced: () => Promise<boolean>;
  reload?: () => void;
};

/*
 * "A new version is ready". It never reloads on its own: the member chooses,
 * and is asked to wait while saved visits are still waiting to sync.
 */
export function UpdatePrompt({ hasUnsynced, reload = reloadPage }: Props) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [blockedBySync, setBlockedBySync] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  useReservedSpace("--banner-top", bannerRef, waiting !== null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    // `ready` rather than getRegistration(): on the very first load that
    // can resolve before the worker has been registered at all.
    void navigator.serviceWorker.ready.then((registration) => {
      if (cancelled) return;
      stop = watchForWaitingWorker(
        registration,
        () => navigator.serviceWorker.controller !== null,
        setWaiting,
      );
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  if (!waiting) return null;

  async function onReload(worker: ServiceWorker) {
    if (await hasUnsynced()) {
      setBlockedBySync(true);
      return;
    }
    setBlockedBySync(false);
    activateWaitingWorker(worker, reload);
  }

  return (
    <div
      ref={bannerRef}
      role="status"
      className="fixed inset-x-0 top-0 z-30 border-b border-border bg-surface px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="mx-auto flex max-w-screen-sm items-center gap-3">
        <p className="flex-1 text-body">
          {blockedBySync
            ? "Update ready. Reload once your saved visits have synced."
            : "Update available."}
        </p>
        <button
          type="button"
          onClick={() => {
            void onReload(waiting);
          }}
          className="min-h-11 rounded-lg bg-primary px-4 text-body font-semibold text-primary-foreground"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
