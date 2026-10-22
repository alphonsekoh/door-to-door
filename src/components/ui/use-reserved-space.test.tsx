import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { useReservedSpace } from "@/components/ui/use-reserved-space";

const reserved = () => document.documentElement.style.getPropertyValue("--banner-bottom");

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  vi.unstubAllGlobals();
});

function setHeight(height: number) {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => height,
  });
}

/*
 * Layout effects run in the same commit as the DOM insert, before the browser
 * paints. Reading the variable from one shows what the first painted frame of
 * the banner gets.
 */
function Banner({ seen }: { seen: string[] }) {
  const ref = useRef<HTMLElement | null>(null);
  useReservedSpace("--banner-bottom", ref, true);
  useLayoutEffect(() => {
    seen.push(reserved());
  }, [seen]);
  return <aside ref={ref}>Banner</aside>;
}

describe("useReservedSpace", () => {
  it("reserves the banner's height before its first frame is painted", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 64,
    });
    const seen: string[] = [];
    const { unmount } = render(<Banner seen={seen} />);

    expect(seen).toEqual(["64px"]);
    unmount();
    expect(reserved()).toBe("");
  });

  it("follows the banner as it grows with the text, with no resize", () => {
    const observers: { measure: () => void; watched: Element[]; disconnect: () => void }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        watched: Element[] = [];
        disconnect = vi.fn();
        constructor(measure: () => void) {
          observers.push({ measure, watched: this.watched, disconnect: this.disconnect });
        }
        observe(target: Element) {
          this.watched.push(target);
        }
      },
    );
    setHeight(64);
    const { unmount } = render(<Banner seen={[]} />);
    expect(reserved()).toBe("64px");

    // The browser calls back for what is watched: the banner itself.
    setHeight(273);
    const banner = screen.getByText("Banner");
    act(() => {
      for (const observer of observers) {
        if (observer.watched.includes(banner)) observer.measure();
      }
    });
    expect(reserved()).toBe("273px");

    unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });
});
