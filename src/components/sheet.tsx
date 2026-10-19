"use client";

import {
  AnimatePresence,
  LazyMotion,
  animate,
  domAnimation,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import * as m from "motion/react-m";
import {
  Fragment,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  DRAG_THRESHOLD,
  FADE,
  SHEET_SPRING,
  type Sample,
  releaseVelocity,
  rubberband,
  settleSpring,
  shouldDismiss,
  toPx,
} from "@/lib/sheet-motion";
import { useModal } from "@/lib/use-modal";

/*
 * Every sheet and confirmation in the app, so they rise, leave and drag the
 * same way and none can drift from the modal rules (D-90).
 *
 * Portalled to the body: a fixed overlay inside a `space-y-*` parent picks up
 * its margin, and one inside a blurred or transformed ancestor is positioned
 * against that ancestor instead of the screen.
 *
 * Wrap the condition that shows it in <SheetPresence> to get the exit: the
 * sheet then leaves the way it came while the modal hands back focus, the
 * page and scrolling at once, so input is never held for an animation. The
 * leaving copy is inert and hidden from assistive tech, so a second tap or
 * Escape cannot close it twice and nothing announces a dialog that has gone.
 * Without the wrapper it simply disappears.
 */

/* Literal per layer: overlay-layers.test.ts reads these from the source. */
const OVERLAY = {
  sheet: "fixed inset-0 z-50 flex flex-col justify-end",
  dialog: "fixed inset-0 z-60 flex flex-col justify-end",
} as const;

/* `origin` is where the sheet was when grabbed: px, or mid-entrance the
   percentage it rose from, read against the panel once it moves. */
type Gesture = {
  id: number;
  from: number;
  origin: number | string;
  dragging: boolean;
  samples: Sample[];
};

type SheetProps = {
  /* The dialog's accessible name. */
  label: string;
  /* Shown beside the close button; without it there is no header row. */
  title?: ReactNode;
  closeLabel?: string;
  backdropLabel?: string;
  onClose: () => void;
  /* A confirmation raised from a sheet sits above it. */
  layer?: keyof typeof OVERLAY;
  role?: "dialog" | "alertdialog";
  initialFocus?: RefObject<HTMLElement | null>;
  /* Drag the handle down to dismiss. Off for confirmations, which should
     take a deliberate answer. */
  draggable?: boolean;
  bodyClassName?: string;
  children: ReactNode;
};

export function Sheet({
  label,
  title,
  closeLabel = "Cancel",
  backdropLabel = "Close",
  onClose,
  layer = "sheet",
  role = "dialog",
  initialFocus,
  draggable = true,
  bodyClassName = "",
  children,
}: SheetProps) {
  const present = useIsPresent();
  const reduce = useReducedMotion() === true;
  const { overlay, panel } = useModal(onClose, initialFocus, present);
  /* Px while dragged; the percentage it rises from while it opens. */
  const y = useMotionValue<number | string>(0);
  const gesture = useRef<Gesture | null>(null);

  /* Grabbing a sheet that is still settling takes it from where it is. */
  function grab(event: ReactPointerEvent<HTMLElement>): void {
    if (!draggable || !event.isPrimary) return;
    y.stop();
    gesture.current = {
      id: event.pointerId,
      from: event.clientY,
      origin: y.get(),
      dragging: false,
      samples: [],
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    const moved = event.clientY - current.from;
    if (!current.dragging) {
      if (Math.abs(moved) < DRAG_THRESHOLD) return;
      // Start from here rather than jump by the threshold.
      current.dragging = true;
      current.from += Math.sign(moved) * DRAG_THRESHOLD;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const height = event.currentTarget.offsetHeight;
    const offset = toPx(current.origin, height) + event.clientY - current.from;
    y.set(offset >= 0 ? offset : -rubberband(-offset, height));
    current.samples.push({ y: offset, t: performance.now() });
  }

  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void {
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragging !== true) return;
    const velocity = releaseVelocity(current.samples);
    const height = event.currentTarget.offsetHeight;
    if (!cancelled && shouldDismiss(toPx(y.get(), height), velocity, height)) {
      // The exit spring starts from here, at the finger's speed.
      onClose();
      return;
    }
    void animate(y, 0, reduce ? { duration: 0 } : settleSpring(velocity));
  }

  const travel = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
    : { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: SHEET_SPRING };

  return createPortal(
    <LazyMotion features={domAnimation} strict>
      <div
        ref={overlay}
        className={OVERLAY[layer]}
        data-state={present ? "open" : "closed"}
        inert={!present}
        aria-hidden={present ? undefined : true}
      >
        {/* Tapping the backdrop closes; a plain button, so it is reachable by
            keyboard and screen reader rather than a click trap. */}
        <m.button
          type="button"
          aria-label={backdropLabel}
          onClick={onClose}
          className="absolute inset-0 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
        />

        <m.div
          ref={panel}
          tabIndex={-1}
          role={role}
          aria-modal="true"
          aria-label={label}
          onPointerMove={move}
          onPointerUp={(event) => {
            release(event, false);
          }}
          onPointerCancel={(event) => {
            release(event, true);
          }}
          style={{ y }}
          {...travel}
          className="relative flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-[0_-0.5rem_2rem_rgb(0_0_0/0.18)] focus:outline-none"
        >
          {draggable || title !== undefined ? (
            <div
              onPointerDown={grab}
              className={`shrink-0 px-4 ${draggable ? "touch-none" : "pt-4"}`}
            >
              {draggable ? (
                <div
                  aria-hidden="true"
                  className="mx-auto my-2 h-1.5 w-10 rounded-full bg-border-strong/60"
                />
              ) : null}
              {title === undefined ? null : (
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-title font-semibold break-words">{title}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-11 shrink-0 text-body btn-text"
                  >
                    {closeLabel}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {/* A field that takes focus is brought fully into view, clear of
              the sticky Save: WebKit leaves one that is partly visible where
              it is, half under the header, with the keyboard up. */}
          <div
            onFocus={(event) => {
              event.target.scrollIntoView({ block: "nearest" });
            }}
            className={`min-h-0 flex-1 scroll-pt-2 scroll-pb-24 overflow-y-auto overscroll-contain px-4 inset-safe-bottom ${bodyClassName}`}
          >
            {children}
          </div>
        </m.div>
      </div>
    </LazyMotion>,
    document.body,
  );
}

/*
 * A sheet's primary action, pinned to the bottom of its scrolling body so
 * Save never needs a scroll to find. Glass over the sheet's own content.
 */
export function SheetActions({ children }: { children: ReactNode }) {
  return (
    <div className="material-chrome sticky bottom-0 -mx-4 mt-4 px-4 py-3 [--material-tint:var(--app-bg)]">
      {children}
    </div>
  );
}

/*
 * Holds a sheet's exit: put the condition that shows the sheet inside, as
 * `{open ? <SomeSheet /> : null}`. Each opening is a new sheet, so one
 * reopened while the last is still sliding away starts fresh rather than
 * coming back with the draft that was just saved.
 */
export function SheetPresence({ children }: { children: ReactNode }) {
  const open = children !== null && children !== undefined && children !== false;
  const [opens, setOpens] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpens((count) => count + 1);
  }
  return (
    <AnimatePresence>{open ? <Fragment key={opens}>{children}</Fragment> : null}</AnimatePresence>
  );
}
