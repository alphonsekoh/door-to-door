import { act, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockHost, DockedActions } from "@/components/docked-actions";
import userEvent from "@testing-library/user-event";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

/* jsdom has no IntersectionObserver; this one is driven by hand. */
function stubObserver() {
  const seen: {
    callback: Callback;
    margin: string | undefined;
    disconnect: () => void;
    observed: Element[];
  }[] = [];
  class Stub {
    disconnect = vi.fn();
    observed: Element[] = [];
    constructor(callback: Callback, options?: IntersectionObserverInit) {
      seen.push({
        callback,
        margin: options?.rootMargin,
        disconnect: this.disconnect,
        observed: this.observed,
      });
    }
    observe = (target: Element) => {
      this.observed.push(target);
    };
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

  it("is in the server's HTML, so Save is on the first paint, and hydrates before it moves", async () => {
    stubObserver();
    const screenWithSave = (
      <DockHost className="space-y-5">
        <form id="visit" aria-label="Visit">
          <input aria-label="Unit" />
          <DockedActions>
            <button type="submit" form="visit">
              Save
            </button>
          </DockedActions>
        </form>
      </DockHost>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(screenWithSave);
    document.body.append(container);
    // Drawn in its form until the host is known.
    const form = within(container).getByRole("form", { name: "Visit" });
    expect(form).toContainElement(within(container).getByRole("button", { name: "Save" }));

    const mismatch = vi.fn();
    const root = await act(() =>
      hydrateRoot(container, screenWithSave, { onRecoverableError: mismatch }),
    );
    expect(mismatch).not.toHaveBeenCalled();
    // Then out to the end of the screen, the one Save there is.
    const saves = within(container).getAllByRole("button", { name: "Save" });
    expect(saves).toHaveLength(1);
    expect(within(container).getByRole("form", { name: "Visit" })).not.toContainElement(
      saves[0] ?? null,
    );
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("in a host, sits at the end of the whole screen, out of its form, and still submits it", async () => {
    const seen = stubObserver();
    const submitted = vi.fn((event: Event) => {
      event.preventDefault();
    });
    render(
      <DockHost className="space-y-5">
        <h1>Blk 123</h1>
        <form
          id="visit"
          aria-label="Visit"
          onSubmit={(event) => {
            submitted(event.nativeEvent);
          }}
        >
          <input aria-label="Unit" />
          <DockedActions>
            <button type="submit" form="visit">
              Save
            </button>
          </DockedActions>
        </form>
      </DockHost>,
    );
    const form = screen.getByRole("form", { name: "Visit" });
    const docked = bar();
    if (docked === null) throw new Error("no bar");
    // Its sticky parent is the host, which starts at the top of the screen.
    expect(form).not.toContainElement(docked);
    expect(docked.parentElement).toContainElement(screen.getByRole("heading", { name: "Blk 123" }));
    // Only the marker follows it.
    expect(docked.nextElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(docked.nextElementSibling?.nextElementSibling).toBeNull();
    // The marker it watches is the one beside it now.
    expect(seen.at(-1)?.observed).toEqual([docked.nextElementSibling]);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).toHaveBeenCalledOnce();
  });
});
