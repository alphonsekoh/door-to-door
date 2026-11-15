import { afterEach, describe, expect, it, vi } from "vitest";
import { stillAt } from "@/lib/still-at";

/* jsdom lays nothing out; its screen is 768px tall. */
function control(top: number, height = 44) {
  const button = document.createElement("button");
  document.body.append(button);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ y: top, width: 300, height }),
  );
  return button;
}

function field() {
  const notes = document.createElement("textarea");
  document.body.append(notes);
  return notes;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("stillAt", () => {
  it("is still at a control on screen while nothing else has focus", () => {
    expect(document.activeElement).toBe(document.body);
    expect(stillAt(control(400))).toBe(true);
  });

  it("is still at a control that kept the tap's focus", () => {
    const button = control(400);
    button.focus();
    expect(stillAt(button)).toBe(true);
  });

  it("counts a control only partly on screen, at either edge", () => {
    expect(stillAt(control(-43))).toBe(true);
    expect(stillAt(control(767))).toBe(true);
  });

  it("has moved on once the control is scrolled off either edge", () => {
    expect(stillAt(control(-1500))).toBe(false);
    expect(stillAt(control(-44))).toBe(false);
    expect(stillAt(control(768))).toBe(false);
  });

  it("has moved on once focus is in another field, though the control is on screen", () => {
    const button = control(400);
    field().focus();
    expect(stillAt(button)).toBe(false);
  });

  it("has moved on once another control has taken focus", () => {
    const button = control(400);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    expect(stillAt(button)).toBe(false);
  });
});
