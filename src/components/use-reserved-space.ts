import { useLayoutEffect, type RefObject } from "react";

/*
 * Fixed banners float over the page, so whatever sits under them is hidden.
 * While one is showing it publishes its own height as a CSS variable; the
 * shell's padding (pt-banner / pb-nav in globals.css) adds it, so content
 * scrolls clear of the banner instead of ending up beneath it.
 *
 * A layout effect, not a passive one: a passive effect runs after paint, so
 * the first frame of every banner covered content with no room reserved.
 */
export function useReservedSpace(
  variable: "--banner-top" | "--banner-bottom",
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;

    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(variable, `${String(element.offsetHeight)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      root.style.removeProperty(variable);
    };
  }, [variable, ref, active]);
}
