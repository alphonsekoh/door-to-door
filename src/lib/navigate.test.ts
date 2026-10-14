import { afterEach, describe, expect, it, vi } from "vitest";
import { destinationAfterSignIn, goTo } from "@/lib/navigate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("goTo", () => {
  it("loads the page in full rather than routing on the client", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    goTo("/history");
    expect(assign).toHaveBeenCalledWith("/history");
  });
});

describe("destinationAfterSignIn", () => {
  it("goes home when there is no callback", () => {
    expect(destinationAfterSignIn(null)).toBe("/");
  });

  it("returns to a path on this origin, query and all", () => {
    expect(destinationAfterSignIn("/units/7?tab=visits")).toBe("/units/7?tab=visits");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "javascript:alert(1)",
    "",
  ])("refuses %j and goes home instead", (callback) => {
    expect(destinationAfterSignIn(callback)).toBe("/");
  });
});
