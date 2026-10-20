"use client";

import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

/*
 * Where a screen's docked bar is drawn: where it is written (outside any
 * host), nowhere while its host draws a stand-in for it (until the host has
 * mounted), or at the end of the host.
 */
type Target = { at: "here" } | { at: "stand-in" } | { at: "host"; element: HTMLElement };

const HERE: Target = { at: "here" };
const STAND_IN: Target = { at: "stand-in" };

const Dock = createContext<Target>(HERE);

/* The bar itself, and the marker after it that DockedActions watches. */
function Bar({
  docked,
  marker,
  children,
}: {
  docked: boolean;
  marker?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <>
      {/* mt-4 collapses with a margin above it; mb-0: a margin below would
          hold the pinned bar off the nav. */}
      <div
        data-dock="nav"
        data-docked={docked ? "" : undefined}
        className={`sticky above-nav -mx-4 mt-4 mb-0 px-4 py-3 ${docked ? "material-chrome" : ""}`}
      >
        {children}
      </div>
      <div ref={marker} aria-hidden="true" className="below-by-nav h-0" />
    </>
  );
}

/*
 * Holds a screen's docked bar at the end of the whole screen rather than of
 * the form it belongs to. A sticky bar cannot rise above the top of its
 * parent: inside a form that starts low on the page (large text, a header
 * with a back link and subtitle) the bar was held below the line above the
 * nav, with Save partly under it until the member scrolled. The host starts
 * at the top of the screen, so the bar can always reach that line.
 *
 * A portal needs the host's element, so the bar only gets there once the
 * host has mounted. Until then, which includes the server's HTML, the host
 * draws `standIn` in the same place: the bar as it first looks. Drawn in its
 * form instead, the first paint at large text had Save mostly under the
 * nav, and it jumped up once the page was live.
 *
 * The screen's content sits in its own box so the bar is the only thing
 * added to the host after it, and stays last.
 */
export function DockHost({
  className,
  standIn,
  children,
}: {
  className: string;
  /* Omitted where nothing is docked on the first paint. */
  standIn?: ReactNode;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const drawsStandIn = standIn !== undefined;
  const target = useMemo<Target>(() => {
    if (host !== null) return { at: "host", element: host };
    return drawsStandIn ? STAND_IN : HERE;
  }, [host, drawsStandIn]);
  return (
    <div ref={setHost}>
      <div className={className}>
        <Dock value={target}>{children}</Dock>
      </div>
      {target.at === "stand-in" ? <Bar docked={false}>{standIn}</Bar> : null}
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
 * Pinned is read from a marker just after the bar, held down in CSS by the
 * bar's own offset: it drops below the screen exactly when the bar is held
 * above the nav. Being CSS, it follows the nav when the text size changes or
 * the phone turns, with nothing to re-measure.
 *
 * Inside a DockHost the bar is moved out of its form, so a submit button in
 * it names the form with `form=`.
 */
export function DockedActions({ children }: { children: ReactNode }) {
  const target = use(Dock);
  const marker = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const host = target.at === "host" ? target.element : null;

  useEffect(() => {
    const markerElement = marker.current;
    if (markerElement === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Out of view above the top means scrolled past, not pinned.
          setDocked(!entry.isIntersecting && entry.boundingClientRect.top > 0);
        }
      },
      { rootMargin: "0px 0px -1px 0px" },
    );
    observer.observe(markerElement);
    return () => {
      observer.disconnect();
    };
  }, [host]);

  if (target.at === "stand-in") return null;
  const bar = (
    <Bar docked={docked} marker={marker}>
      {children}
    </Bar>
  );
  return host === null ? bar : createPortal(bar, host);
}
