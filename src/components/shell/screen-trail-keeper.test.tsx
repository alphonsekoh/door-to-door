import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenTrailKeeper } from "@/components/shell/screen-trail-keeper";
import { canRetrace, resetTrail } from "@/lib/session/screen-trail";

const route = vi.hoisted(() => ({ pathname: "/follow-ups" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

beforeEach(() => {
  resetTrail();
  route.pathname = "/follow-ups";
});

describe("ScreenTrailKeeper", () => {
  it("records each screen the member moves to", () => {
    const { rerender } = render(<ScreenTrailKeeper />);
    expect(canRetrace()).toBe(false);
    route.pathname = "/households/h1";
    rerender(<ScreenTrailKeeper />);
    expect(canRetrace()).toBe(true);
  });

  it("treats a browser Back or Forward as landing somewhere unknown", () => {
    const { rerender } = render(<ScreenTrailKeeper />);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    route.pathname = "/households/h1";
    rerender(<ScreenTrailKeeper />);
    expect(canRetrace()).toBe(false);
  });

  it("stops listening when it goes", () => {
    const { unmount } = render(<ScreenTrailKeeper />);
    unmount();
    window.dispatchEvent(new PopStateEvent("popstate"));
    route.pathname = "/households/h1";
    render(<ScreenTrailKeeper />);
    expect(canRetrace()).toBe(true);
  });
});
