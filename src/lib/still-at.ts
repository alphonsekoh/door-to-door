/*
 * Whether the member is still at a control when its answer lands: the control
 * on screen, and focus not moved on to anything else. On poor signal an
 * answer can land long after the tap, once the member has scrolled down to
 * the interest picker or is typing a note, and bringing it into view then
 * pulls the page away from where they are working (#160).
 */
export function stillAt(control: Element): boolean {
  const { top, bottom } = control.getBoundingClientRect();
  const focused = document.activeElement;
  /* A tapped button takes focus on Android but not on iOS, and a control
     disabled while it reads may hand focus back to the page. */
  const focusStayed = focused === document.body || control.contains(focused);
  return bottom > 0 && top < window.innerHeight && focusStayed;
}
