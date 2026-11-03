"use client";

import { useEffect, useRef, type RefObject } from "react";

/*
 * What makes a sheet or dialog a modal rather than a box drawn over the page:
 * focus moves in, Tab stays in, Escape closes, focus goes back to whatever
 * opened it, and the page behind cannot be reached or scrolled.
 *
 * Open modals form a stack, so a confirm raised from a sheet owns the keyboard
 * until it closes and Escape only ever closes the top one.
 *
 * A blocking modal (no onClose) cannot be dismissed and stays on top of the
 * stack: a sheet that opens while it is up goes in beneath it, so nothing the
 * page does afterwards can take the keyboard away from it.
 */

type Layer = {
  overlay: HTMLElement;
  panel: HTMLElement;
  close: () => void;
  blocking: boolean;
};

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const layers: Layer[] = [];
const madeInert = new Set<Element>();
let lockedOverflow = "";
/* Created on first open: this module is also evaluated during server
   rendering, where MutationObserver does not exist. */
let ancestors: MutationObserver | undefined;

/*
 * Everything outside the top overlay goes inert: the siblings of each of its
 * ancestors, up to the body. The overlay itself stays live, because its
 * backdrop is a button that closes it. Elements that were already inert are
 * left alone so closing does not wake something another part of the app hid.
 *
 * Each ancestor is watched while a layer is open, so a sibling that mounts
 * later (an update or install banner under the account message) goes inert
 * too. Only childList is observed: setting inert here does not re-trigger it.
 */
function syncInert(): void {
  ancestors ??= new MutationObserver(syncInert);
  ancestors.disconnect();
  for (const element of madeInert) element.removeAttribute("inert");
  madeInert.clear();

  const top = layers.at(-1);
  if (top === undefined) return;
  let node: Element = top.overlay;
  let parent = node.parentElement;
  while (parent !== null && node !== document.body) {
    ancestors.observe(parent, { childList: true });
    for (const sibling of parent.children) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      madeInert.add(sibling);
    }
    node = parent;
    parent = node.parentElement;
  }
}

/*
 * Tab is moved by hand rather than left to the browser: inert is what keeps
 * native tabbing out of the page behind, and stepping explicitly means the
 * wrap at either end does not depend on it.
 */
function handleKey(layer: Layer, event: KeyboardEvent): void {
  if (layers.at(-1) !== layer) return;

  if (event.key === "Escape") {
    // Escape that ends an IME composition belongs to the text field. WebKit
    // sends that keydown with isComposing false, flagged only by keyCode 229;
    // keyCode is deprecated but has no replacement for this signal.
    if (event.isComposing || Reflect.get(event, "keyCode") === 229) return;
    event.preventDefault();
    layer.close();
    return;
  }

  if (event.key !== "Tab") return;
  event.preventDefault();
  const items = [...layer.panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const at = items.findIndex((item) => item === document.activeElement);
  const step = event.shiftKey ? -1 : 1;
  // From the panel itself, Tab goes to the first control and Shift+Tab to the last.
  const from = at === -1 && event.shiftKey ? 0 : at;
  (items[(from + step + items.length) % items.length] ?? layer.panel).focus();
}

/* The <label> a member knows the field by, if it has one. */
function labelOf(field: HTMLElement): HTMLLabelElement | undefined {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    return field.labels?.[0];
  }
  return undefined;
}

/*
 * The field, then its label, brought into view clear of the pinned chrome,
 * the label winning where both will not fit. `nearest` alone lined a tall
 * note's foot up with a sheet's docked Send at large text, its label and top
 * under the sheet's header. A label already whole is left where it is; one
 * that `nearest` had to move was cut off, and goes to the top with `start`,
 * since `nearest` lines up the foot of a label taller than the room.
 */
function bringIntoView(field: HTMLElement): void {
  field.scrollIntoView({ block: "nearest" });
  const label = labelOf(field);
  if (label === undefined) return;
  const top = label.getBoundingClientRect().top;
  label.scrollIntoView({ block: "nearest" });
  if (label.getBoundingClientRect().top !== top) label.scrollIntoView({ block: "start" });
}

/*
 * The element `returnFocus` holds as the modal closes, not as it opened: the
 * field a dialog was about may have re-rendered since. Brought into view, as
 * it may be the one thing on the form the member cannot see. Otherwise focus
 * goes back to what opened the modal, where it was, if that is still there.
 */
function giveFocusBack(
  returnFocus: RefObject<HTMLElement | null> | undefined,
  trigger: Element | null,
): void {
  const named = returnFocus?.current;
  if (named?.isConnected === true) {
    named.focus({ preventScroll: true });
    bringIntoView(named);
  } else if (trigger instanceof HTMLElement && trigger.isConnected) {
    trigger.focus({ preventScroll: true });
  }
}

/*
 * Attach `overlay` to the full-screen element holding the backdrop and
 * `panel` to the element with role="dialog". The panel needs tabIndex={-1}:
 * it takes focus on open unless `initialFocus` names a control, so a screen
 * reader announces the dialog's label first and a phone does not raise the
 * keyboard into a field nobody tapped.
 *
 * Pass `null` for `onClose` to make it blocking; that is decided when it opens.
 *
 * `active` false lets go while the element is still on screen: a sheet
 * animating out hands back focus, the page and scrolling as its exit starts,
 * so nothing waits on the animation. True again takes them back.
 *
 * `returnFocus` names where focus goes on close instead of what opened it:
 * the field a Not saved dialog was about (D-119-15).
 */
export function useModal<Panel extends HTMLElement = HTMLDivElement>(
  onClose: (() => void) | null,
  initialFocus?: RefObject<HTMLElement | null>,
  active = true,
  returnFocus?: RefObject<HTMLElement | null>,
): { overlay: RefObject<HTMLDivElement | null>; panel: RefObject<Panel | null> } {
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<Panel>(null);
  /* Callers pass a fresh closure every render; the modal opens once. */
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const overlayElement = overlay.current;
    const panelElement = panel.current;
    if (!active || overlayElement === null || panelElement === null) return;

    const trigger = document.activeElement;
    const layer: Layer = {
      overlay: overlayElement,
      panel: panelElement,
      close: () => {
        close.current?.();
      },
      blocking: close.current === null,
    };
    const onKey = (event: KeyboardEvent) => {
      handleKey(layer, event);
    };

    if (layers.length === 0) {
      lockedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const blocker = layers.findIndex((open) => open.blocking);
    if (layer.blocking || blocker === -1) layers.push(layer);
    else layers.splice(blocker, 0, layer);
    syncInert();
    document.addEventListener("keydown", onKey);
    // Without a scroll: a modal opens at its top, so a long one's heading is
    // read before the OK at its foot that takes focus.
    if (layers.at(-1) === layer) {
      (initialFocus?.current ?? panelElement).focus({ preventScroll: true });
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      // Not necessarily the top: a sheet and its confirm can unmount together.
      layers.splice(layers.indexOf(layer), 1);
      syncInert();
      if (layers.length === 0) document.body.style.overflow = lockedOverflow;
      // Focus stays in a blocking modal when something beneath it closes.
      if (layers.at(-1)?.blocking !== true) giveFocusBack(returnFocus, trigger);
    };
    // Ref objects, so this still runs once per open.
  }, [initialFocus, active, returnFocus]);

  return { overlay, panel };
}
