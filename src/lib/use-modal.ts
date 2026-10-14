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

/*
 * Everything outside the top overlay goes inert: the siblings of each of its
 * ancestors, up to the body. The overlay itself stays live, because its
 * backdrop is a button that closes it. Elements that were already inert are
 * left alone so closing does not wake something another part of the app hid.
 */
function syncInert(): void {
  for (const element of madeInert) element.removeAttribute("inert");
  madeInert.clear();

  const top = layers.at(-1);
  if (top === undefined) return;
  let node: Element = top.overlay;
  let parent = node.parentElement;
  while (parent !== null && node !== document.body) {
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

/*
 * Attach `overlay` to the full-screen element holding the backdrop and
 * `panel` to the element with role="dialog". The panel needs tabIndex={-1}:
 * it takes focus on open unless `initialFocus` names a control, so a screen
 * reader announces the dialog's label first and a phone does not raise the
 * keyboard into a field nobody tapped.
 *
 * Pass `null` for `onClose` to make it blocking; that is decided when it opens.
 */
export function useModal<Panel extends HTMLElement = HTMLDivElement>(
  onClose: (() => void) | null,
  initialFocus?: RefObject<HTMLElement | null>,
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
    if (overlayElement === null || panelElement === null) return;

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
    if (layers.at(-1) === layer) (initialFocus?.current ?? panelElement).focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      // Not necessarily the top: a sheet and its confirm can unmount together.
      layers.splice(layers.indexOf(layer), 1);
      syncInert();
      if (layers.length === 0) document.body.style.overflow = lockedOverflow;
      // Focus stays in a blocking modal when something beneath it closes.
      const stillBlocked = layers.at(-1)?.blocking === true;
      if (!stillBlocked && trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
    // A ref object, so this still runs once per open.
  }, [initialFocus]);

  return { overlay, panel };
}
