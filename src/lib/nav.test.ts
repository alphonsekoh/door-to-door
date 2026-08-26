import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/nav";

const exact: NavItem = { href: "/", label: "Session", matchPrefix: false };
const prefixed: NavItem = { href: "/history", label: "History", matchPrefix: true };

describe("isActiveRoute", () => {
  it("matches an exact route", () => {
    expect(isActiveRoute("/", exact)).toBe(true);
  });

  it("does not match a different route", () => {
    expect(isActiveRoute("/history", exact)).toBe(false);
  });

  it("does not treat a nested path as active when matchPrefix is false", () => {
    // Without this, "/" would light up on every page in the app.
    expect(isActiveRoute("/history/123", exact)).toBe(false);
  });

  it("matches the prefix route itself", () => {
    expect(isActiveRoute("/history", prefixed)).toBe(true);
  });

  it("matches a nested path under a prefix route", () => {
    expect(isActiveRoute("/history/session/42", prefixed)).toBe(true);
  });

  it("does not match a sibling route sharing a name prefix", () => {
    // "/history-of-blocks" starts with "/history" as a string but is a
    // different route, so the separator check has to be on the boundary.
    expect(isActiveRoute("/history-of-blocks", prefixed)).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(isActiveRoute("/account", prefixed)).toBe(false);
  });
});

describe("NAV_ITEMS", () => {
  it("exposes the four primary destinations", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/history",
      "/follow-ups",
      "/account",
    ]);
  });

  it("gives every item a label", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label).not.toBe("");
    }
  });

  it("only uses prefix matching for nested sections", () => {
    // The root route must stay exact or it matches everything.
    const root = NAV_ITEMS.find((item) => item.href === "/");
    expect(root?.matchPrefix).toBe(false);
  });
});
