import { describe, expect, it } from "vitest";
import { sessionAction, statusLabel } from "@/lib/session/sessions";

describe("sessionAction", () => {
  it("marks only ending as destructive", () => {
    expect(sessionAction("active").destructive).toBe(true);
    expect(sessionAction("draft").destructive).toBe(false);
    expect(sessionAction("ended").destructive).toBe(false);
  });

  it("offers start on a draft", () => {
    expect(sessionAction("draft").action).toBe("start");
  });

  it("offers end while it runs", () => {
    expect(sessionAction("active").action).toBe("end");
  });

  it("always offers reopen on an ended outing", () => {
    // The failure this guards against is ending by mistake, which locks a
    // member out mid-amendment. Reopen must never be missing.
    expect(sessionAction("ended").action).toBe("reopen");
  });

  it("asks before ending, because members lose access until it is reopened", () => {
    expect(sessionAction("active").confirm).toContain("reopened");
  });

  it("does not stand between an admin and reopening", () => {
    expect(sessionAction("ended").confirm).toBeNull();
  });

  it("does not stand between an admin and starting", () => {
    expect(sessionAction("draft").confirm).toBeNull();
  });

  it("labels every action", () => {
    for (const status of ["draft", "active", "ended"] as const) {
      expect(sessionAction(status).label).not.toBe("");
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
