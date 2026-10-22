import { act, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockHost, DockedActions, useDockedBarOnScreen } from "@/components/ui/docked-actions";
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

  it("is drawn by its host on the first paint, where it will dock, and hydrates before it moves", async () => {
    stubObserver();
    const screenWithSave = (
      <DockHost className="space-y-5" standIn={<button type="button">Save</button>}>
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
    // In the server's HTML: the stand-in, at the end of the screen, not in
    // the form, so it can rise to the nav before any script has run.
    const standIn = within(container).getByRole("button", { name: "Save" });
    expect(within(container).getByRole("form", { name: "Visit" })).not.toContainElement(standIn);
    expect(standIn).not.toHaveAttribute("form");
    expect(standIn.closest("[data-dock]")?.nextElementSibling?.nextElementSibling).toBeNull();

    const mismatch = vi.fn();
    const root = await act(() =>
      hydrateRoot(container, screenWithSave, { onRecoverableError: mismatch }),
    );
    expect(mismatch).not.toHaveBeenCalled();
    // Then the form's own bar takes its place: one Save, the live one.
    const saves = within(container).getAllByRole("button", { name: "Save" });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toHaveAttribute("form", "visit");
    expect(within(container).getByRole("form", { name: "Visit" })).not.toContainElement(
      saves[0] ?? null,
    );
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("gives the stand-in its glass in CSS, read from its marker, as no script is there to watch", async () => {
    stubObserver();
    const screenWithSave = (
      <DockHost className="space-y-5" standIn={<button type="button">Save</button>}>
        <DockedActions>
          <button type="submit">Save</button>
        </DockedActions>
      </DockHost>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(screenWithSave);
    document.body.append(container);
    try {
      const standIn = within(container).getByRole("button", { name: "Save" }).parentElement;
      // The timeline is named on the marker and seen across the host.
      expect(container.firstElementChild).toHaveClass("dock-scope");
      expect(standIn?.nextElementSibling).toHaveClass("dock-marker");
      const glass = standIn?.querySelector(".dock-glass");
      expect(glass).toHaveClass("material-chrome");
      expect(glass).toHaveAttribute("aria-hidden", "true");

      const root = await act(() => hydrateRoot(container, screenWithSave));
      // The live bar is told by its observer instead.
      const live = within(container).getByRole("button", { name: "Save" }).parentElement;
      expect(live?.querySelector(".dock-glass")).toBeNull();
      expect(live?.nextElementSibling).not.toHaveClass("dock-marker");
      act(() => {
        root.unmount();
      });
    } finally {
      container.remove();
    }
  });

  it("with no stand-in, is drawn in its form until the host has mounted", () => {
    const html = renderToString(
      <DockHost className="space-y-5">
        <form id="visit" aria-label="Visit">
          <DockedActions>
            <button type="submit">Save</button>
          </DockedActions>
        </form>
      </DockHost>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(within(container).getByRole("form", { name: "Visit" })).toContainElement(
      within(container).getByRole("button", { name: "Save" }),
    );
  });

  it("tells the rest of the screen while a bar is docked", () => {
    stubObserver();
    const seen: boolean[] = [];
    function Watcher() {
      seen.push(useDockedBarOnScreen());
      return null;
    }
    const { rerender } = render(
      <>
        <Watcher />
        <DockedActions>
          <button type="button">Save</button>
        </DockedActions>
      </>,
    );
    expect(seen.at(-1)).toBe(true);
    rerender(<Watcher />);
    expect(seen.at(-1)).toBe(false);
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
