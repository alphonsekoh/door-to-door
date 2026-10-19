"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * A page's primary action, pinned just above the bottom nav (D-25-4).
 *
 * While pinned it is glass, and it and the nav read as one slab: the nav drops
 * its own lit edge (bottom-nav.tsx). Resting in the page, at the end of a form
 * short enough to need no scroll, it is just part of the page; glass there
 * would be a tinted strip floating over nothing.
 *
 * Pinned is read from a marker just after the bar: it leaves the area above
 * the nav exactly when the bar is held there.
 */
export function DockedActions({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    const barElement = bar.current;
    const markerElement = marker.current;
    if (barElement === null || markerElement === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const offset = Number.parseFloat(getComputedStyle(barElement).bottom) || 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Out of view above the top means scrolled past, not pinned.
          setDocked(!entry.isIntersecting && entry.boundingClientRect.top > 0);
        }
      },
      { rootMargin: `0px 0px ${String(-Math.ceil(offset) - 1)}px 0px` },
    );
    observer.observe(markerElement);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {/* mb-0: a margin would hold the pinned bar off the nav. */}
      <div
        ref={bar}
        data-dock="nav"
        data-docked={docked ? "" : undefined}
        className={`sticky above-nav -mx-4 mb-0 px-4 py-3 ${docked ? "material-chrome" : ""}`}
      >
        {children}
      </div>
      <div ref={marker} aria-hidden="true" className="h-0" />
    </>
  );
}
