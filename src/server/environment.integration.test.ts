import { describe, expect, it } from "vitest";

/*
 * Holds the integration project open until the real database tests arrive in
 * #7/#8. Kept deliberately free of a database dependency so it runs anywhere,
 * and asserts the one thing the suite genuinely relies on: a Node environment,
 * not jsdom. Database-backed tests replace this file.
 */
describe("integration environment", () => {
  it("runs under Node, not a browser-like environment", () => {
    expect(typeof process.versions.node).toBe("string");
    expect(globalThis).not.toHaveProperty("document");
  });

  it("has no DATABASE_URL configured yet", () => {
    // Flips to a real connection check once #7 lands.
    expect(process.env["DATABASE_URL"] ?? null).toBeNull();
  });
});
