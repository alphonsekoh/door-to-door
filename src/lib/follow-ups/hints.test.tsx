import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HINTS_CHANGED,
  dismissHint,
  isHintDismissed,
  markDeclinedSeen,
  seenDeclined,
} from "@/lib/follow-ups/hints";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("first-use hints", () => {
  it("shows a hint until it is dismissed on this phone", () => {
    expect(isHintDismissed("follow-ups")).toBe(false);
    dismissHint("follow-ups");
    expect(isHintDismissed("follow-ups")).toBe(true);
    expect(isHintDismissed("other")).toBe(false);
  });

  it("tells the page a hint was dismissed, so every copy of it hides", () => {
    const heard = vi.fn();
    window.addEventListener(HINTS_CHANGED, heard);
    dismissHint("follow-ups");
    window.removeEventListener(HINTS_CHANGED, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("shows the hint again when storage cannot be read", () => {
    dismissHint("follow-ups");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isHintDismissed("follow-ups")).toBe(false);
  });

  it("does not fail when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => {
      dismissHint("follow-ups");
    }).not.toThrow();
    expect(isHintDismissed("follow-ups")).toBe(false);
  });
});

describe("declined suggestions already seen", () => {
  it("remembers each one acknowledged", () => {
    expect(seenDeclined()).toEqual(new Set());
    markDeclinedSeen("n1");
    markDeclinedSeen("n2");
    expect(seenDeclined()).toEqual(new Set(["n1", "n2"]));
  });

  it("ignores what it cannot read as a list of ids", () => {
    localStorage.setItem("d2d:declined-seen", "not json");
    expect(seenDeclined()).toEqual(new Set());
    localStorage.setItem("d2d:declined-seen", JSON.stringify({ n1: true }));
    expect(seenDeclined()).toEqual(new Set());
    localStorage.setItem("d2d:declined-seen", JSON.stringify(["n1", 7, null]));
    expect(seenDeclined()).toEqual(new Set(["n1"]));
  });
});
