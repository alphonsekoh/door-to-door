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
  useEffect,
  useLayoutEffect,
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
  resist,
  scrimOpacity,
  settleSpring,
  shouldDismiss,
  throwSpring,
  toPx,
  unresist,
} from "@/lib/session/sheet-motion";
import { useModal } from "@/lib/hooks/use-modal";
import { wholeControl } from "@/lib/whole-control";

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
  /* The id of what it says, read out with its name as it opens. */
  describedBy?: string | undefined;
  /* Shown beside the close button; without it there is no header row. */
  title?: ReactNode;
  closeLabel?: string;
  backdropLabel?: string;
  onClose: () => void;
  /* A confirmation raised from a sheet sits above it. */
  layer?: keyof typeof OVERLAY;
  role?: "dialog" | "alertdialog";
  initialFocus?: RefObject<HTMLElement | null>;
  /* Where focus goes on close, instead of back to what opened it. */
  returnFocus?: RefObject<HTMLElement | null> | undefined;
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
  describedBy,
  title,
  closeLabel = "Cancel",
  backdropLabel = "Close",
  onClose,
  layer = "sheet",
  role = "dialog",
  initialFocus,
  returnFocus,
  draggable = true,
  discard,
  bodyClassName = "",
  children,
}: SheetProps) {
  const present = useIsPresent();
  const reduce = useReducedMotion() === true;
  const { overlay, panel } = useModal(onClose, initialFocus, present, returnFocus);
  const body = useRef<HTMLDivElement>(null);
  /* Opens at its top, after the modal has focused it. Focus on an alert's
     OK, at its foot, scrolls the body down to it, and at large text a tall
     one opened with its heading cut away. */
  useEffect(() => {
    if (body.current !== null) body.current.scrollTop = 0;
  }, []);
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
          aria-describedby={describedBy}
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
                  squeeze it below 12ch of body text, the width title rows
                  keep (D-111-25). The basis sits on a body-size box so it
                  is measured in body text: 8ch of the larger title let "Add
                  households" stand a word a line beside Cancel. */}
              {title === undefined ? null : (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="min-w-0 flex-[1_1_12ch] text-body">
                    <p className="text-title font-semibold break-words">{title}</p>
                  </div>
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
              it is, half under the header, with the keyboard up. A box
              drawn as a tile brings its whole tile. The bar is pinned in
              view, but the padding that clears it counts it as covered:
              scrolled to, Save moved the form by the bar's height, even
              when given focus back without a scroll (#214). */}
          <div
            ref={body}
            data-sheet-body=""
            onFocus={(event) => {
              if (event.target.closest("[data-sheet-actions]") !== null) return;
              wholeControl(event.target).scrollIntoView({ block: "nearest" });
            }}
            className={`min-h-0 flex-1 scroll-pt-2 scroll-clear-sheet-actions overflow-y-auto overscroll-contain px-4 inset-safe-bottom ${bodyClassName}`}
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
 * Confirmation for the things that take something away, a sheet's own
 * "discard this?" among them: kept beside Sheet so the two never import each
 * other.
 *
 * Not window.confirm: it cannot be styled to reach the thumb, it blocks the
 * whole page, and it says "localhost:3000 says" above the question.
 *
 * Destructive by default, because nearly every use removes something, and a
 * confirm that looks like Save is one a thumb confirms without reading.
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  cancelLabel = "Keep as it is",
  busy,
  tone = "destructive",
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy: boolean;
  tone?: "destructive" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  /* Focus lands on the way out, not on the button that takes something away. */
  const keep = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      label={title}
      role="alertdialog"
      layer="dialog"
      backdropLabel="Cancel"
      onClose={onCancel}
      initialFocus={keep}
      draggable={false}
      bodyClassName="pt-4"
    >
      <p className="text-title font-semibold">{title}</p>
      <p className="mt-1 text-body text-foreground-muted">{detail}</p>

      <div className="mt-4 space-y-2 pb-4">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`${tone === "destructive" ? "btn-danger" : "btn-primary"} min-h-14 w-full rounded-xl text-title font-semibold`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          ref={keep}
          type="button"
          onClick={onCancel}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          {cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}

/*
 * A sheet's primary action, pinned to the bottom of its scrolling body so
 * Save never needs a scroll to find. Glass over the sheet's own content.
 *
 * At the 16px base whatever the text size, as the page's docked Save is,
 * with its edges in line with the body's. Grown with the text, at 32px on an
 * iPhone 13 it was 160px of a sheet whose header took 284px, and a field
 * OK on Not saved brought back started under Send. Its `note`, why the
 * action is held back, is content: it keeps the reader's size, so a member
 * without signal can read why Send is grey.
 *
 * The body is told how tall the bar is drawn, note and all, so a field that
 * takes focus is brought clear of it (scroll-clear-sheet-actions).
 */
export function SheetActions({
  note = null,
  noteId,
  children,
}: {
  note?: string | null;
  /* For the action to name the note with aria-describedby. */
  noteId?: string;
  children: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  /* Before paint, so nothing is focused against a bar of the wrong height. */
  useLayoutEffect(() => {
    const element = bar.current;
    const body = element?.closest<HTMLElement>("[data-sheet-body]");
    if (!element || !body) return;
    const measure = () => {
      body.style.setProperty("--sheet-actions", `${String(element.offsetHeight)}px`);
    };
    measure();
    // The note comes and goes, and wraps anew when the text size changes,
    // which re-renders nothing.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      body.style.removeProperty("--sheet-actions");
    };
  }, []);

  return (
    <div
      ref={bar}
      data-sheet-actions=""
      className="material-chrome sticky bottom-0 bleed-x mt-4 py-3 chrome-size [--material-tint:var(--app-bg)]"
    >
      {note === null ? null : (
        <p id={noteId} className="mb-2 text-center text-caption text-foreground-muted reader-size">
          {note}
        </p>
      )}
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
