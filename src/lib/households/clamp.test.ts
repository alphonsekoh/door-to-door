import { describe, expect, it } from "vitest";
import { CLAMP_CHARS, clampDescription } from "@/lib/households/clamp";

describe("clampDescription", () => {
  it("leaves a short description whole", () => {
    expect(clampDescription("Asked us back on Sunday")).toEqual({
      shown: "Asked us back on Sunday",
      clipped: false,
    });
    expect(clampDescription("one\ntwo\nthree")).toEqual({
      shown: "one\ntwo\nthree",
      clipped: false,
    });
    const edge = "a".repeat(CLAMP_CHARS);
    expect(clampDescription(edge)).toEqual({ shown: edge, clipped: false });
  });

  it("cuts after the third line", () => {
    expect(clampDescription("one\ntwo\nthree \nfour")).toEqual({
      shown: "one\ntwo\nthree…",
      clipped: true,
    });
  });

  it("cuts a long description at the last word that fits", () => {
    const text = `${"word ".repeat(40)}end`;
    const { shown, clipped } = clampDescription(text);
    expect(clipped).toBe(true);
    expect(shown.endsWith("word…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(CLAMP_CHARS + 1);
  });

  it("keeps a word that ends exactly at the limit", () => {
    const text = `${"a".repeat(CLAMP_CHARS)} more`;
    expect(clampDescription(text).shown).toBe(`${"a".repeat(CLAMP_CHARS)}…`);
  });

  it("cuts one unbroken run at the limit", () => {
    expect(clampDescription("b".repeat(CLAMP_CHARS + 20)).shown).toBe(
      `${"b".repeat(CLAMP_CHARS)}…`,
    );
  });

  it("applies the line cut before the length cut", () => {
    const text = `${"x ".repeat(100)}\ntwo\nthree\nfour`;
    const { shown } = clampDescription(text);
    expect(shown.endsWith("x…")).toBe(true);
    expect(shown).not.toContain("two");
  });
});
