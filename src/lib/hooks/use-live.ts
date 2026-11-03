"use client";

import { useSyncExternalStore } from "react";

/* Nothing changes it once the page is live. */
function subscribe(): () => void {
  return () => undefined;
}

/*
 * Whether React has taken the page over: false in the server's HTML and
 * while it hydrates, true from the render after. Until then a key or a tap
 * reaches only the browser, which does what it would with no script.
 */
export function useLive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
