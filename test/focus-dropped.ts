import { waitFor } from "@testing-library/react";
import { expect } from "vitest";

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
