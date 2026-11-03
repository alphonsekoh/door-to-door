import { config } from "zod";
import { describe, expect, it } from "vitest";

describe("client instrumentation", () => {
  it("turns zod's eval probe off before any client schema is built", async () => {
    // Otherwise the browser reports zod's `new Function` probe as a CSP
    // violation on every page load.
    expect(config().jitless).not.toBe(true);
    await import("@/instrumentation-client");
    expect(config().jitless).toBe(true);
  });
});
