"use client";

import {
  AnimatePresence,
  LazyMotion,
  animate,
  domAnimation,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DRAG_THRESHOLD,
  FADE,
  SHEET_SPRING,
  type Sample,
  releaseVelocity,
  resist,
  scrimOpacity,
  settleSpring,
  shouldDismiss,
  throwSpring,
  toPx,
  unresist,
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

/*
 * The scrim and the panel are moved by Motion alone, so both are
 * `transition-none`. Given a CSS transition (a button's press fade, or the
 * reduced-motion rule's 0.01ms on everything), WebKit replays the fade from
 * transparent as Motion hands the finished value back to the page: a
 * one-frame blink, or the scrim fading in twice.
 */

/* Literal per layer: overlay-layers.test.ts reads these from the source. */
const OVERLAY = {
  sheet: "fixed inset-0 z-50 flex flex-col justify-end",
  dialog: "fixed inset-0 z-60 flex flex-col justify-end",
} as const;

/* `origin` is where the sheet was when the drag began: px, or mid-entrance
   the percentage it was rising from, read against the panel as it moves.
   `samples` follow the finger and `shown` the sheet; they part where it
   resists. */
type Gesture = {
  id: number;
  from: number;
  origin: number | string;
  dragging: boolean;
  samples: Sample[];
  shown: Sample[];
};

/* What to ask before throwing away work the sheet holds. */
export type Discard = { title: string; detail: string };

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
  /* Set while the sheet holds typed work that is not saved. A drag down then
     meets resistance and springs back, and it or a tap on the backdrop asks
     before anything is thrown away, as iOS does. Cancel is a deliberate
     answer already, so it still closes at once. */
  discard?: Discard | undefined;
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
  discard,
  bodyClassName = "",
  children,
}: SheetProps) {
  const present = useIsPresent();
  const reduce = useReducedMotion() === true;
  const { overlay, panel } = useModal(onClose, initialFocus, present);
  /* Px while dragged; the percentage it rises from while it opens. */
  const y = useMotionValue<number | string>(0);
  const gesture = useRef<Gesture | null>(null);
  /* Where a dismissing drag sends the sheet, and how fast it was going. */
  const [thrown, setThrown] = useState<{ to: number; velocity: number } | null>(null);
  const [asking, setAsking] = useState<Discard | null>(null);
  /* The scrim lightens as the sheet is pulled down, and darkens as it rises. */
  const dim = useTransform(y, (offset) => scrimOpacity(offset, panel.current?.offsetHeight ?? 0));

  /* Nothing stops until the touch is known to be a drag: a tap that stopped
     the rise or a settle would leave the sheet resting partway. */
  function grab(event: ReactPointerEvent<HTMLElement>): void {
    if (!draggable || !event.isPrimary) return;
    gesture.current = {
      id: event.pointerId,
      from: event.clientY,
      origin: 0,
      dragging: false,
      samples: [],
      shown: [],
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    const moved = event.clientY - current.from;
    if (!current.dragging) {
      if (Math.abs(moved) < DRAG_THRESHOLD) return;
      // A sheet still settling is taken from where it is, and starts from
      // here rather than jumping by the threshold.
      y.stop();
      current.origin = y.get();
      current.dragging = true;
      current.from += Math.sign(moved) * DRAG_THRESHOLD;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const height = event.currentTarget.offsetHeight;
    const guarded = discard !== undefined;
    const start = unresist(toPx(current.origin, height), height, guarded);
    const offset = start + event.clientY - current.from;
    const shown = resist(offset, height, guarded);
    y.set(shown);
    const t = performance.now();
    current.samples.push({ y: offset, t });
    current.shown.push({ y: shown, t });
  }

  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void {
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragging !== true) return;
    const at = performance.now();
    const velocity = releaseVelocity(current.samples, at);
    const height = event.currentTarget.offsetHeight;
    const offset = unresist(toPx(y.get(), height), height, discard !== undefined);
    if (!cancelled && shouldDismiss(offset, velocity, height)) {
      if (discard === undefined) {
        // Leaves from here at the finger's speed. Motion's own reading of the
        // value's speed has lapsed by the time the exit starts, after a render.
        setThrown({ to: height, velocity });
        onClose();
        return;
      }
      // Springs back, and asks over it.
      setAsking(discard);
    }
    // Back at the speed the sheet itself was moving, which a resisted pull
    // makes slower than the finger.
    const settle = settleSpring(releaseVelocity(current.shown, at));
    void animate(y, 0, reduce ? { duration: 0 } : settle);
  }

  function tapBackdrop(): void {
    if (discard === undefined) {
      onClose();
      return;
    }
    // Answered, focus comes back to the sheet, not to the backdrop just tapped.
    panel.current?.focus();
    setAsking(discard);
  }

  const travel = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
    : {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit:
          thrown === null
            ? { y: "100%" }
            : { y: thrown.to, transition: throwSpring(thrown.velocity) },
        transition: SHEET_SPRING,
      };

  /* With motion, the scrim follows the sheet's travel; reduced, the two
     cross-fade together instead. */
  const fade = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
    : {};

  const sheet = createPortal(
    <LazyMotion features={domAnimation} strict>
      <div
        ref={overlay}
        className={OVERLAY[layer]}
        data-state={present ? "open" : "closed"}
        inert={!present}
        aria-hidden={present ? undefined : true}
      >
        {/* Tapping the backdrop closes; a plain button, so it is reachable by
            keyboard and screen reader rather than a click trap. It takes no
            press dim: that would lighten the scrim under the finger. */}
        <m.button
          type="button"
          aria-label={backdropLabel}
          onClick={tapBackdrop}
          className="absolute inset-0 transition-none active:opacity-100"
          {...fade}
        >
          <m.span
            aria-hidden="true"
            className="absolute inset-0 bg-black/40 transition-none"
            style={{ opacity: dim }}
          />
        </m.button>

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
          className="relative flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-[0_-0.5rem_2rem_rgb(0_0_0/0.18)] transition-none focus:outline-none"
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
              {/* At large text Cancel drops under the title rather than
                  squeeze it to a letter a line. */}
              {title === undefined ? null : (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="min-w-0 flex-[1_1_8ch] text-title font-semibold break-words">
                    {title}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="ml-auto min-h-11 shrink-0 text-body btn-text"
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

  return (
    <>
      {sheet}
      <SheetPresence>
        {asking === null ? null : (
          <ConfirmDialog
            title={asking.title}
            detail={asking.detail}
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            busy={false}
            onConfirm={() => {
              setAsking(null);
              onClose();
            }}
            onCancel={() => {
              setAsking(null);
            }}
          />
        )}
      </SheetPresence>
    </>
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
