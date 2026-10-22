import { afterEach, describe, expect, it, vi } from "vitest";
import {
  destinationAfterSignIn,
  goTo,
  isLeavingOnPurpose,
  reloadPage,
} from "@/lib/session/navigate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("goTo", () => {
  it("loads the page in full rather than routing on the client", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign }, addEventListener: vi.fn() });
    goTo("/history");
    expect(assign).toHaveBeenCalledWith("/history");
  });
});

describe("leaving on purpose", () => {
  /* A window whose pageshow listeners the test can fire. */
  function stubWindow() {
    const target = new EventTarget();
    const location = { assign: vi.fn(), reload: vi.fn() };
    vi.stubGlobal("window", {
      location,
      addEventListener: target.addEventListener.bind(target),
    });
    return { location, show: () => target.dispatchEvent(new Event("pageshow")) };
  }

  it("marks the app's own navigations, and forgets once the page is shown again", () => {
    const { location, show } = stubWindow();
    goTo("/sign-in");
    expect(isLeavingOnPurpose()).toBe(true);
    // Restored from the back/forward cache: in use again.
    show();
    expect(isLeavingOnPurpose()).toBe(false);

    reloadPage();
    expect(location.reload).toHaveBeenCalled();
    expect(isLeavingOnPurpose()).toBe(true);
    show();
    expect(isLeavingOnPurpose()).toBe(false);
  });
});

describe("destinationAfterSignIn", () => {
  it("goes home when there is no callback", () => {
    expect(destinationAfterSignIn(null)).toBe("/");
  });

  it("returns to a path on this origin, query and all", () => {
    expect(destinationAfterSignIn("/units/7?tab=visits#latest")).toBe("/units/7?tab=visits#latest");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\t/evil.example/",
    "/\n/evil.example/",
    "/\r\\evil.example/",
    "\t//evil.example/",
    "/.//evil.example/",
    "/a/..//evil.example/",
    "javascript:alert(1)",
    "http://[evil",
    "",
  ])("refuses %j and goes home instead", (callback) => {
    expect(destinationAfterSignIn(callback)).toBe("/");
  });
});
