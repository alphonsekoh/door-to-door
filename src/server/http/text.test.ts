import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/http/errors";
import { BLANK_MESSAGE, requireText } from "@/server/http/text";

describe("requireText", () => {
  it("returns the value as it is stored, trimmed", () => {
    expect(requireText("  #05-123 ", "/unitNumber")).toBe("#05-123");
    expect(requireText("Call back", "/note")).toBe("Call back");
  });

  it.each(["", "   ", "\t\n 　", " ﻿"])(
    "refuses %j as validation_failed, naming the field",
    (value) => {
      let thrown: unknown;
      try {
        requireText(value, "/note");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown).toMatchObject({
        status: 400,
        code: "validation_failed",
        details: [{ path: "/note", message: BLANK_MESSAGE }],
      });
    },
  );

  it("agrees with the contract's pattern on every character", () => {
    // The contract refuses what /\S/ does not match; this refuses what trim()
    // empties. A character only one of them counts as a space would let a
    // value through one guard that the other refuses.
    const pattern = /\S/;
    const disagree: string[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const char = String.fromCharCode(code);
      if (pattern.test(char) !== (char.trim() !== "")) disagree.push(code.toString(16));
    }
    expect(disagree).toEqual([]);
  });
});
