import { describe, expect, it } from "vitest";
import { checkTeamName } from "@/lib/teams/team-name";

describe("checkTeamName", () => {
  it("trims and accepts an ordinary name", () => {
    expect(checkTeamName("  Pair 1 ")).toEqual({ ok: true, name: "Pair 1" });
  });

  it("refuses a blank name", () => {
    expect(checkTeamName("   ")).toMatchObject({ ok: false });
  });

  it("counts code points on the trimmed name against 60", () => {
    expect(checkTeamName(`${"😀".repeat(60)} `)).toMatchObject({ ok: true });
    expect(checkTeamName("😀".repeat(61))).toMatchObject({
      ok: false,
      message: expect.stringContaining("60") as string,
    });
  });

  it("refuses characters that print nothing or reorder text", () => {
    expect(checkTeamName("Pair​1")).toMatchObject({ ok: false });
    expect(checkTeamName("‮evil")).toMatchObject({ ok: false });
  });

  it("refuses a name with no letter, number or emoji", () => {
    expect(checkTeamName("...")).toMatchObject({ ok: false });
  });

  it("accepts an emoji-only name", () => {
    expect(checkTeamName("🚪")).toMatchObject({ ok: true });
  });
});
