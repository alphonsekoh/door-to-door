import type { ComponentType } from "react";

export type SyncQueueView = ComponentType<{ open: boolean; onClose: () => void }>;

/* The sync sheet, and Motion with it, as a chunk of its own: the bar is in
   the root layout, so a static import would put the animation library on
   every page, sign-in included. */
export function loadSyncQueue(): Promise<SyncQueueView> {
  return import("@/components/sync/sync-queue-sheet").then((module) => module.SyncQueuePresence);
}
