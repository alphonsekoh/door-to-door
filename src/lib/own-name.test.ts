import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, checkOwnName } from "@/lib/own-name";

describe("checkOwnName", () => {
  it("trims what it accepts", () => {
    expect(checkOwnName("  Alice Tan \n")).toEqual({ ok: true, name: "Alice Tan" });
  });

  it("refuses blank and whitespace-only names", () => {
    expect(checkOwnName("")).toMatchObject({ ok: false });
    expect(checkOwnName("   \t")).toMatchObject({ ok: false });
  });

  it("counts the limit after trimming", () => {
    expect(checkOwnName(` ${"a".repeat(MAX_NAME_LENGTH)} `)).toMatchObject({ ok: true });
    expect(checkOwnName("a".repeat(MAX_NAME_LENGTH + 1))).toMatchObject({ ok: false });
  });
});
