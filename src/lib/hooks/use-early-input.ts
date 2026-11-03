"use client";

import { useLayoutEffect, useRef } from "react";

/*
 * A field in the server's HTML can be typed into, or a radio picked, before
 * the page is live (#113). Hydrating leaves that in the field but not in
 * state, and React's next render puts the state back. So once, as the
 * component mounts and before anything renders again, what the field holds
 * is handed on as if just entered. A field React drew itself already holds
 * its state, so nothing happens.
 */
export function useEarlyInput<T>(
  /* Undefined where there is nothing to read. */
  read: () => T | undefined,
  held: T | null,
  enter: (entered: T) => void,
): void {
  const looked = useRef(false);
  useLayoutEffect(() => {
    if (looked.current) return;
    looked.current = true;
    const entered = read();
    if (entered !== undefined && entered !== held) enter(entered);
  }, [read, held, enter]);
}
