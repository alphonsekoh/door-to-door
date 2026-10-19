import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockedActions } from "@/components/docked-actions";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

/* jsdom has no IntersectionObserver; this one is driven by hand. */
function stubObserver() {
  const seen: { callback: Callback; margin: string | undefined; disconnect: () => void }[] = [];
  class Stub {
    disconnect = vi.fn();
    constructor(callback: Callback, options?: IntersectionObserverInit) {
      seen.push({ callback, margin: options?.rootMargin, disconnect: this.disconnect });
    }
    observe = vi.fn();
  }
  vi.stubGlobal("IntersectionObserver", Stub);
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function bar() {
  return screen.getByRole("button", { name: "Save" }).parentElement;
}

describe("DockedActions", () => {
  it("turns to glass only while it is pinned on the nav", () => {
    const seen = stubObserver();
    render(
      <DockedActions>
        <button type="button">Save</button>
      </DockedActions>,
    );
    expect(bar()).toHaveClass("sticky", "above-nav");
    expect(bar()).not.toHaveClass("material-chrome");

    const observer = seen[0];
    if (observer === undefined) throw new Error("not observed");
    // The marker after it has dropped below the line above the nav.
    act(() => {
      observer.callback([
        { isIntersecting: false, boundingClientRect: { top: 900 } as DOMRectReadOnly },
      ]);
    });
    expect(bar()).toHaveClass("material-chrome");
    expect(bar()).toHaveAttribute("data-docked");

    // Back in the page, at the end of the form.
    act(() => {
      observer.callback([
        { isIntersecting: true, boundingClientRect: { top: 400 } as DOMRectReadOnly },
      ]);
    });
    expect(bar()).not.toHaveClass("material-chrome");
    expect(bar()).not.toHaveAttribute("data-docked");
  });

  it("is not pinned when the form has scrolled away above", () => {
    const seen = stubObserver();
    render(
      <DockedActions>
        <button type="button">Save</button>
      </DockedActions>,
    );
    act(() => {
      seen[0]?.callback([
        { isIntersecting: false, boundingClientRect: { top: -200 } as DOMRectReadOnly },
      ]);
    });
    expect(bar()).not.toHaveAttribute("data-docked");
  });

  it("stops watching when it goes", () => {
    const seen = stubObserver();
    const { unmount } = render(
      <DockedActions>
        <button type="button">Save</button>
      </DockedActions>,
    );
    unmount();
    expect(seen[0]?.disconnect).toHaveBeenCalled();
  });

  it("stays a plain bar where the browser cannot watch", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <DockedActions>
        <button type="button">Save</button>
      </DockedActions>,
    );
    expect(bar()).toHaveClass("sticky");
    expect(bar()).not.toHaveClass("material-chrome");
  });
});
