import { act } from "@testing-library/react";

/*
 * WebKit can run an answer's code inside the input event of text landing in
 * a field: after the field has changed, before React has read it (#155).
 * `land` releases the answer then: the field already holds `typed` and
 * window.event is that input event, as the browser has it, with React's own
 * scheduling rather than act's. The event then reaches React, as the
 * browser's goes on to.
 */
export async function landWhileTyping(
  field: HTMLInputElement,
  typed: string,
  land: () => void,
): Promise<void> {
  const typing = new Event("input", { bubbles: true });
  const event = Object.getOwnPropertyDescriptor(window, "event");
  const actEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  try {
    // The browser's edit, which React learns of only from the event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, typed);
    Object.defineProperty(window, "event", { configurable: true, get: () => typing });
    land();
    /* The answer's code and whatever React does at once with it; nothing it
       leaves for later. */
    for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
  } finally {
    if (event === undefined) Reflect.deleteProperty(window, "event");
    else Object.defineProperty(window, "event", event);
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
  }
  act(() => {
    field.dispatchEvent(typing);
  });
}
