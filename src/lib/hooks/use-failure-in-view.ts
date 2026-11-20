"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/*
 * Brings a failure into view as it is drawn, before paint, and no further
 * than `nearest` needs: clear of a sheet's bar by its body's scroll padding
 * (D-225-3), or of the nav and a banner floating on it by the block's own
 * `scroll-clear-nav` (D-195-1). Put the ref on the alert, or on one block
 * holding it with the control it is about.
 *
 * Only a failure appearing scrolls (D-213-3): nothing on open, on success,
 * or when a second try clears it, and a value that has not changed scrolls
 * nothing again. `redrawn` changes when a read the failure set off redraws
 * the screen around it, which brings a kept failure into view again
 * (D-226-4). Call it below `useRefusalFocus`, so the pressed button has
 * focus back, without a scroll, first (D-208-4). The alert takes no focus.
 */
export function useFailureInView<T extends HTMLElement>(
  failure: object | string | null,
  redrawn = 0,
): RefObject<T | null> {
  const said = useRef<T>(null);
  useLayoutEffect(() => {
    if (failure !== null) said.current?.scrollIntoView({ block: "nearest" });
  }, [failure, redrawn]);
  return said;
}
