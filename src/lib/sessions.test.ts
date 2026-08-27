import { describe, expect, it } from "vitest";
import { availableActions, statusLabel } from "@/lib/sessions";

describe("availableActions", () => {
  it("offers only start on a draft", () => {
    expect(availableActions("draft").map((spec) => spec.action)).toEqual(["start"]);
  });

  it("offers only end while it runs", () => {
    expect(availableActions("active").map((spec) => spec.action)).toEqual(["end"]);
  });

  it("always offers reopen on an ended outing", () => {
    // The failure this guards against is ending by mistake, which locks a
    // member out mid-amendment. Reopen must never be missing.
    expect(availableActions("ended").map((spec) => spec.action)).toEqual(["reopen"]);
  });

  it("asks before ending, because members lose access until it is reopened", () => {
    expect(availableActions("active")[0]?.confirm).toContain("reopened");
  });

  it("does not stand between an admin and reopening", () => {
    expect(availableActions("ended")[0]?.confirm).toBeNull();
  });

  it("does not stand between an admin and starting", () => {
    expect(availableActions("draft")[0]?.confirm).toBeNull();
  });

  it("labels every action", () => {
    for (const status of ["draft", "active", "ended"] as const) {
      for (const spec of availableActions(status)) {
        expect(spec.label).not.toBe("");
      }
    }
  });
});

describe("statusLabel", () => {
  it.each([
    ["draft", "Draft"],
    ["active", "Running now"],
    ["ended", "Ended"],
  ] as const)("reads %s as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});
