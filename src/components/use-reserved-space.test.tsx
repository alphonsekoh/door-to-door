import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { useReservedSpace } from "@/components/use-reserved-space";

const reserved = () => document.documentElement.style.getPropertyValue("--banner-bottom");

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
});

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
});
