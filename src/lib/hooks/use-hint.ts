"use client";

import { useCallback, useSyncExternalStore } from "react";
import { HINTS_CHANGED, dismissHint, isHintDismissed } from "@/lib/follow-ups/hints";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(HINTS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(HINTS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/*
 * A dismissible first-use hint. The server and the first client render say
 * dismissed, so nothing is drawn until the phone's own answer is read after
 * hydration: no mismatch, and no hint flashing up for someone who closed it.
 */
export function useHint(id: string): { show: boolean; dismiss: () => void } {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => isHintDismissed(id),
    () => true,
  );
  const dismiss = useCallback(() => {
    dismissHint(id);
  }, [id]);
  return { show: !dismissed, dismiss };
}
