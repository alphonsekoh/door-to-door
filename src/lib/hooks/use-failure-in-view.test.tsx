import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { useFailureInView } from "@/lib/hooks/use-failure-in-view";

/* The shape of every place that uses it: the alert is drawn only while
   there is a failure, and carries the ref. */
function Place({ failure, redrawn }: { failure: object | string | null; redrawn?: number }) {
  const said = useFailureInView<HTMLParagraphElement>(failure, redrawn);
  return (
    <div>
      <button type="button">Save</button>
      {failure === null ? null : (
        <p ref={said} role="alert">
          Refused.
        </p>
      )}
    </div>
  );
}

describe("useFailureInView", () => {
  let scrolled: MockInstance<Element["scrollIntoView"]>;

  beforeEach(() => {
    scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  });

  afterEach(() => {
    scrolled.mockRestore();
  });

  it("brings a failure into view as it is drawn, no further than it needs, and gives it no focus", () => {
    const { rerender } = render(<Place failure={null} />);
    rerender(<Place failure="Could not save." />);

    const alert = screen.getByRole("alert");
    expect(scrolled.mock.contexts).toEqual([alert]);
    expect(scrolled.mock.calls).toEqual([[{ block: "nearest" }]]);
    expect(alert).not.toHaveFocus();
  });

  it("scrolls nothing while there is no failure, nor as one clears", () => {
    const { rerender } = render(<Place failure={null} />);
    rerender(<Place failure={null} />);
    expect(scrolled).not.toHaveBeenCalled();

    rerender(<Place failure="Could not save." />);
    rerender(<Place failure={null} />);
    expect(scrolled).toHaveBeenCalledOnce();
  });

  it("scrolls again for each failure set anew, never for the same one drawn again", () => {
    const first = { at: "save", message: "Could not save." };
    const { rerender } = render(<Place failure={first} />);
    rerender(<Place failure={first} />);
    expect(scrolled).toHaveBeenCalledOnce();

    // Set again, as a second refusal does, even with the same words.
    rerender(<Place failure={{ ...first }} />);
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  /* A read the refusal set off can draw more above the failure it kept,
     and push it off the screen (D-226-4). */
  it("brings a kept failure into view again as a read redraws the screen around it, and only then", () => {
    const { rerender } = render(<Place failure="Could not save." redrawn={0} />);
    rerender(<Place failure="Could not save." redrawn={1} />);
    expect(scrolled).toHaveBeenCalledTimes(2);
    expect(scrolled.mock.contexts).toEqual([screen.getByRole("alert"), screen.getByRole("alert")]);

    // With nothing to say, a redraw moves nothing.
    rerender(<Place failure={null} redrawn={1} />);
    rerender(<Place failure={null} redrawn={2} />);
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});
