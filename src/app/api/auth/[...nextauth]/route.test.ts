import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

/*
 * A two-line re-export, but the one that decides whether sign-in exists at
 * all. A rename in Auth.js would fail here rather than at runtime.
 */
describe("auth catch-all route", () => {
  it("exports a GET handler", () => {
    expect(typeof GET).toBe("function");
  });

  it("exports a POST handler", () => {
    expect(typeof POST).toBe("function");
  });
});
