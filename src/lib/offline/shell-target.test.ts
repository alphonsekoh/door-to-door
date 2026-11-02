import { describe, expect, it } from "vitest";
import { shellTarget } from "@/lib/offline/shell-target";

const BLOCK = "0190a000-0000-7000-8000-000000000123";

describe("shellTarget", () => {
  it("names the block a household on the list was opened at, with its unit", () => {
    expect(shellTarget(`/blocks/${BLOCK}`, "?unit=%2311-90")).toEqual({
      blockId: BLOCK,
      unit: "#11-90",
    });
  });

  it("names a block with no unit, as a reload on a block screen does", () => {
    expect(shellTarget(`/blocks/${BLOCK}/`, "")).toEqual({ blockId: BLOCK, unit: "" });
  });

  it.each(["/", "/offline", "/history", "/blocks", "/blocks/", `/blocks/${BLOCK}/units`])(
    "names nothing for %s",
    (pathname) => {
      expect(shellTarget(pathname, "?unit=%2311-90")).toBeNull();
    },
  );
});
