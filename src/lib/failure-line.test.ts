import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";

const FALLBACK = "Could not load this unit.";

const refusal = (status: number, code: string, message: string) =>
  new ApiRequestError(status, { error: { code, message } });

describe("failureLine", () => {
  it("shows the server's sentence for a refusal", () => {
    expect(
      failureLine(refusal(409, "conflict", "Another session is already running."), FALLBACK),
    ).toBe("Another session is already running.");
  });

  it("keeps the fixed sentence ApiRequestError gives a body outside the envelope", () => {
    expect(failureLine(new ApiRequestError(502, "<html>Bad gateway</html>"), FALLBACK)).toBe(
      "Something went wrong.",
    );
  });

  it.each([
    ["Chromium's lost connection", new TypeError("Failed to fetch")],
    ["Safari's and WebKit's lost connection", new TypeError("Load failed")],
    ["Firefox's lost connection", new TypeError("NetworkError when attempting to fetch resource.")],
  ])("shows the screen's sentence, not the browser's, for %s", (_, error) => {
    expect(failureLine(error, FALLBACK)).toBe(FALLBACK);
  });

  it("shows the screen's sentence for any other error, whatever its text", () => {
    expect(failureLine(new SyntaxError("Unexpected token '<'"), FALLBACK)).toBe(FALLBACK);
    expect(failureLine(new Error("That session has ended."), FALLBACK)).toBe(FALLBACK);
    expect(failureLine(new DOMException("signal timed out", "TimeoutError"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it.each([
    ["a string", "offline"],
    ["undefined", undefined],
    ["an object", { message: "x" }],
  ])("shows the screen's sentence for %s thrown", (_, thrown) => {
    expect(failureLine(thrown, FALLBACK)).toBe(FALLBACK);
  });
});
