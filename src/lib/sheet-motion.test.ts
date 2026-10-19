import { describe, expect, it } from "vitest";
import {
  DECELERATION,
  FLICK_VELOCITY,
  SHEET_SPRING,
  project,
  releaseVelocity,
  rubberband,
  toPx,
  settleSpring,
  shouldDismiss,
} from "@/lib/sheet-motion";

describe("project", () => {
  it("throws a moving sheet as far as a scroll view would coast", () => {
    // 1000 px/s at the normal rate coasts 499 px: (1000 / 1000) * 0.998 / 0.002.
    expect(project(1000)).toBeCloseTo(499);
    expect(project(-1000)).toBeCloseTo(-499);
    expect(project(0)).toBe(0);
  });

  it("coasts less at a snappier rate", () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, DECELERATION));
  });
});

describe("rubberband", () => {
  it("follows less the further it is pulled past the edge", () => {
    const near = rubberband(10, 600);
    const far = rubberband(200, 600);
    expect(near).toBeLessThan(10);
    expect(far).toBeLessThan(200);
    expect(far / 200).toBeLessThan(near / 10);
  });

  it("never passes the dimension itself, however far it is pulled", () => {
    expect(rubberband(1e9, 600)).toBeLessThan(600);
  });
});

describe("toPx", () => {
  it("reads an offset in px, whether a number or a px string", () => {
    expect(toPx(42, 600)).toBe(42);
    expect(toPx("42px", 600)).toBe(42);
  });

  it("turns a percentage of the sheet into px", () => {
    expect(toPx("50%", 600)).toBe(300);
    expect(toPx("100%", 600)).toBe(600);
  });
});

describe("releaseVelocity", () => {
  it("is zero with nothing, or one sample, to go on", () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ y: 40, t: 1000 }])).toBe(0);
  });

  it("measures px/s over the last moments of the drag", () => {
    expect(
      releaseVelocity([
        { y: 0, t: 1000 },
        { y: 20, t: 1050 },
        { y: 50, t: 1100 },
      ]),
    ).toBe(500);
  });

  it("ignores how fast the drag was earlier on", () => {
    // A fast start then a pause: only the pause counts at release.
    expect(
      releaseVelocity([
        { y: 0, t: 0 },
        { y: 300, t: 50 },
        { y: 300, t: 400 },
        { y: 300, t: 450 },
      ]),
    ).toBe(0);
  });

  it("is negative for a drag back up", () => {
    expect(
      releaseVelocity([
        { y: 100, t: 0 },
        { y: 60, t: 80 },
      ]),
    ).toBe(-500);
  });
});

describe("shouldDismiss", () => {
  const height = 600;

  it("decides a clear throw by its direction alone", () => {
    // A tall sheet barely moved: where it would coast to is not far enough,
    // but the throw says to go.
    expect(shouldDismiss(5, FLICK_VELOCITY, 800)).toBe(true);
    // Pulled most of the way down, then thrown back up: it stays.
    expect(shouldDismiss(500, -FLICK_VELOCITY, height)).toBe(false);
  });

  it("dismisses a slow release only where it would come to rest far enough down", () => {
    expect(shouldDismiss(250, 0, height)).toBe(true);
    expect(shouldDismiss(200, 0, height)).toBe(false);
    // 100 px/s more carries 200 px past the 40% line.
    expect(shouldDismiss(200, 100, height)).toBe(true);
  });

  it("settles back from a small nudge", () => {
    expect(shouldDismiss(20, 50, height)).toBe(false);
  });
});

describe("springs", () => {
  it("opens and closes critically damped", () => {
    expect(SHEET_SPRING.bounce).toBe(0);
  });

  it("carries the finger's velocity back to rest, with a bounce only after a throw", () => {
    expect(settleSpring(200)).toMatchObject({ bounce: 0, velocity: 200 });
    expect(settleSpring(-FLICK_VELOCITY)).toMatchObject({ bounce: 0.15, velocity: -500 });
  });
});
