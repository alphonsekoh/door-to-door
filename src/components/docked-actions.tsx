"use client";

import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * Where a screen's docked bar is put: undefined outside any host (the bar
 * stays where it is written), null while the host is mounting.
 */
const Dock = createContext<HTMLElement | null | undefined>(undefined);

/*
 * Holds a screen's docked bar at the end of the whole screen rather than of
 * the form it belongs to. A sticky bar cannot rise above the top of its
 * parent: inside a form that starts low on the page (large text, a header
 * with a back link and subtitle) the bar was held below the line above the
 * nav, with Save partly under it until the member scrolled. The host starts
 * at the top of the screen, so the bar can always reach that line.
 *
 * The screen's content sits in its own box so the bar is the only thing
 * added to the host after it, and stays last.
 */
export function DockHost({ className, children }: { className: string; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setHost}>
      <div className={className}>
        <Dock value={host}>{children}</Dock>
      </div>
    </div>
  );
}

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
 *
 * Inside a DockHost the bar is moved out of its form, so a submit button in
 * it names the form with `form=`.
 */
export function DockedActions({ children }: { children: ReactNode }) {
  const host = use(Dock);
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
  }, [host]);

  if (host === null) return null;

  const dock = (
    <>
      {/* mt-4 collapses with a margin above it; mb-0: a margin below would
          hold the pinned bar off the nav. */}
      <div
        ref={bar}
        data-dock="nav"
        data-docked={docked ? "" : undefined}
        className={`sticky above-nav -mx-4 mt-4 mb-0 px-4 py-3 ${docked ? "material-chrome" : ""}`}
      >
        {children}
      </div>
      <div ref={marker} aria-hidden="true" className="h-0" />
    </>
  );
  return host === undefined ? dock : createPortal(dock, host);
}
