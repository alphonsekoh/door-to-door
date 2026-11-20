import { waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

/*
 * Presses a button from the keyboard, as the sign-in E2E does (D-214-6).
 * Enter clicks only what has focus, so the press itself shows the button
 * held focus: a test cannot reach `focusDropped()` with focus that was on
 * the page all along, where the press noted nothing to give back.
 */
export async function pressByKey(user: UserEvent, button: HTMLElement): Promise<void> {
  button.focus();
  expect(button).toHaveFocus();
  await user.keyboard("{Enter}");
}

/*
 * Holds a test until a button disabled while its request is out has lost
 * focus to the page, as a browser's does at its next rendering update
 * (R-199). It waits for the drop, not a count of frames (D-214-1), and
 * fails if the drop never comes: a refocus test that never saw focus leave
 * would pass without the fix (D-208-6).
 */
export async function focusDropped(): Promise<void> {
  await waitFor(() => {
    expect(document.body).toHaveFocus();
  });
}
