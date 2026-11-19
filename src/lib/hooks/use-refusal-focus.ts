"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/*
 * A button disabled while its request is out loses focus: the browser moves
 * it to the page, and leaves it there if the request is refused (R-200). A
 * keyboard member then starts again from the top. This gives it back, the
 * rule #211 set on sign-in (D-208-3).
 *
 * `notePress()` goes at the press, before anything is disabled; it notes the
 * button the press focused, and a tap on an iPhone focuses none. `refused()`
 * goes beside the refusal's own state. As that is drawn, focus goes back to
 * the button only if it is still on the page: never out of where the member
 * has put it since, nor off a sheet's panel. Everything outside the top
 * modal is inert, so the page is the only place outside one that focus can
 * fall to.
 *
 * Without a scroll, ahead of the refusal's own scroll into view (D-208-4):
 * call this above the layout effect that does it.
 */
export function useRefusalFocus(): { notePress: () => void; refused: () => void } {
  const pressed = useRef<HTMLButtonElement | null>(null);
  /* A count, not the message: a refusal can repeat with nothing else changed. */
  const [refusals, setRefusals] = useState(0);

  useLayoutEffect(() => {
    const button = pressed.current;
    pressed.current = null;
    if (button !== null && document.activeElement === document.body) {
      button.focus({ preventScroll: true });
    }
  }, [refusals]);

  const notePress = useCallback(() => {
    const focused = document.activeElement;
    pressed.current = focused instanceof HTMLButtonElement ? focused : null;
  }, []);
  const refused = useCallback(() => {
    setRefusals((count) => count + 1);
  }, []);

  return { notePress, refused };
}
