import { beforeEach, describe, expect, it } from "vitest";
import { arrived, canRetrace, resetTrail, traversed } from "@/lib/screen-trail";

beforeEach(() => {
  resetTrail();
});

describe("screen trail", () => {
  it("has nothing to retrace on the first screen of a load", () => {
    arrived("/households/h1");
    expect(canRetrace()).toBe(false);
  });

  it("retraces to the in-app screen pushed from", () => {
    arrived("/follow-ups");
    arrived("/households/h1");
    expect(canRetrace()).toBe(true);
  });

  it("ignores a re-render of the same screen", () => {
    arrived("/households/h1");
    arrived("/households/h1");
    expect(canRetrace()).toBe(false);
  });

  it("never retraces to a public screen such as sign-in", () => {
    arrived("/sign-in");
    arrived("/households/h1");
    expect(canRetrace()).toBe(false);
  });

  it("forgets what is behind after a browser Back or Forward", () => {
    arrived("/blocks/b1");
    traversed();
    arrived("/households/h1");
    expect(canRetrace()).toBe(false);
    // The next push has a known screen behind it again.
    arrived("/blocks/b1");
    expect(canRetrace()).toBe(true);
  });
});
