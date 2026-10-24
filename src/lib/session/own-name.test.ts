import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  NAME_FALLBACK,
  checkOwnName,
  displayName,
  firstName,
  nameLength,
} from "@/lib/session/own-name";

describe("checkOwnName", () => {
  it("trims what it accepts", () => {
    expect(checkOwnName("  Alice Tan \n")).toEqual({ ok: true, name: "Alice Tan" });
  });

  it("accepts names in other scripts and with punctuation", () => {
    expect(checkOwnName("陈大文")).toMatchObject({ ok: true });
    expect(checkOwnName("Mary-Anne O'Neil")).toMatchObject({ ok: true });
  });

  it("refuses blank and whitespace-only names", () => {
    expect(checkOwnName("")).toMatchObject({ ok: false });
    expect(checkOwnName("   \t")).toMatchObject({ ok: false });
  });

  it("counts code points on the trimmed name", () => {
    expect(checkOwnName(` ${"a".repeat(MAX_NAME_LENGTH)} `)).toMatchObject({ ok: true });
    expect(checkOwnName("a".repeat(MAX_NAME_LENGTH + 1))).toMatchObject({ ok: false });
    expect(checkOwnName("😀".repeat(41))).toMatchObject({ ok: true });
    expect(checkOwnName("😀".repeat(MAX_NAME_LENGTH + 1))).toMatchObject({ ok: false });
    expect(nameLength("😀a")).toBe(2);
  });

  it.each([
    ["zero-width space", "​"],
    ["zero-width joiner", "‍"],
    ["word joiner", "⁠"],
    ["byte order mark", "﻿"],
    ["a control character", "Al\u0007ice"],
    ["a right-to-left override", "‮Alice"],
    ["a line separator", "Al ice"],
  ])("refuses %s", (_label, name) => {
    expect(checkOwnName(name)).toMatchObject({ ok: false });
    expect(checkOwnName(`A${name}B`)).toMatchObject({ ok: false });
  });

  it("refuses a name with nothing readable in it", () => {
    expect(checkOwnName("---")).toMatchObject({ ok: false });
    expect(checkOwnName("!?")).toMatchObject({ ok: false });
  });
});

describe("names as shown", () => {
  it("takes the first word of a name", () => {
    expect(firstName("Ann Tan")).toBe("Ann");
    expect(firstName("  Ben  ")).toBe("Ben");
  });

  it("falls back for a person with no name", () => {
    expect(displayName(null)).toBe(NAME_FALLBACK);
    expect(displayName("   ")).toBe("Someone");
    expect(displayName(" Ann Tan ")).toBe("Ann Tan");
    expect(firstName(null)).toBe("Someone");
  });
});
