import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinationAfterSignIn } from "@/lib/session/navigate";
import type * as NavigateModule from "@/lib/session/navigate";

/* The "leaving on purpose" flag is module state, so each test reads a fresh copy. */
let navigate: typeof NavigateModule;

beforeEach(async () => {
  vi.resetModules();
  navigate = await import("@/lib/session/navigate");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* A window whose pageshow listeners the test can fire, and a root to hide. */
function stubWindow() {
  const target = new EventTarget();
  const location = { assign: vi.fn(), replace: vi.fn(), reload: vi.fn() };
  const root = { style: { visibility: "" } };
  vi.stubGlobal("window", {
    location,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  });
  vi.stubGlobal("document", { documentElement: root });
  /* Node has no PageTransitionEvent; persisted is all the guard reads. */
  const show = (persisted: boolean) =>
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  return { location, root, show };
}

describe("goTo", () => {
  it("loads the page in full rather than routing on the client", () => {
    const { location } = stubWindow();
    navigate.goTo("/history");
    expect(location.assign).toHaveBeenCalledWith("/history");
    expect(navigate.isLeavingOnPurpose()).toBe(true);
  });
});

describe("replaceWith", () => {
  it("loads the page in full in place of the current one, so Back cannot return to it", () => {
    const { location } = stubWindow();
    expect(navigate.isLeavingOnPurpose()).toBe(false);
    navigate.replaceWith("/sign-in");
    expect(location.replace).toHaveBeenCalledWith("/sign-in");
    expect(location.assign).not.toHaveBeenCalled();
    expect(navigate.isLeavingOnPurpose()).toBe(true);
  });
});

describe("reloadPage", () => {
  it("reloads as a departure the app chose", () => {
    const { location } = stubWindow();
    navigate.reloadPage();
    expect(location.reload).toHaveBeenCalledOnce();
    expect(navigate.isLeavingOnPurpose()).toBe(true);
  });
});

describe("reloadWhenRestored", () => {
  it("leaves a page loaded the ordinary way alone", () => {
    const { location, root, show } = stubWindow();
    navigate.reloadWhenRestored();
    show(false);
    expect(location.reload).not.toHaveBeenCalled();
    expect(root.style.visibility).toBe("");
    expect(navigate.isLeavingOnPurpose()).toBe(false);
  });

  it("hides a page restored from the back/forward cache and loads it again", () => {
    const { location, root, show } = stubWindow();
    navigate.reloadWhenRestored();
    show(true);
    // Hidden, so a slow reload never shows the screen as it was left.
    expect(root.style.visibility).toBe("hidden");
    expect(location.reload).toHaveBeenCalledOnce();
    // As the app's own reload, so the unsent-records warning does not hold it up.
    expect(navigate.isLeavingOnPurpose()).toBe(true);
  });

  it("does not take the leaving mark back when a page left on purpose is restored", () => {
    // The guard's reload follows; a prompt there would show over the old screen.
    const { show } = stubWindow();
    navigate.reloadWhenRestored();
    navigate.goTo("/sign-in");
    show(true);
    expect(navigate.isLeavingOnPurpose()).toBe(true);
  });

  it("stops once removed", () => {
    const { location, show } = stubWindow();
    const remove = navigate.reloadWhenRestored();
    remove();
    show(true);
    expect(location.reload).not.toHaveBeenCalled();
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
