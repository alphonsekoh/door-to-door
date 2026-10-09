"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/* navigator.onLine can say true on a dead connection, so callers also treat a
   failed fetch as offline. The server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
