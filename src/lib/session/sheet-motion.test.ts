import { describe, expect, it } from "vitest";
import {
  DECELERATION,
  FLICK_VELOCITY,
  SHEET_SPRING,
  type Spring,
  project,
  releaseVelocity,
  resist,
  rubberband,
  scrimOpacity,
  toPx,
  settleSpring,
  shouldDismiss,
  spring,
  throwSpring,
  unresist,
  unrubberband,
} from "@/lib/session/sheet-motion";

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

describe("unrubberband", () => {
  it("undoes rubberband, either side of the edge", () => {
    for (const pulled of [1, 40, 300, 2000]) {
      expect(unrubberband(rubberband(pulled, 600), 600)).toBeCloseTo(pulled);
      expect(unrubberband(rubberband(-pulled, 600), 600)).toBeCloseTo(-pulled);
    }
  });
});

describe("resist", () => {
  it("follows the finger down, and resists only above its resting place", () => {
    expect(resist(120, 600, false)).toBe(120);
    expect(resist(-120, 600, false)).toBe(-rubberband(120, 600));
  });

  it("resists going down too while it holds unsaved work, so it can be tugged but not thrown", () => {
    const tugged = resist(300, 600, true);
    expect(tugged).toBe(rubberband(300, 600));
    expect(tugged).toBeGreaterThan(0);
    expect(tugged).toBeLessThan(300);
    expect(resist(-120, 600, true)).toBe(-rubberband(120, 600));
  });

  it("is undone by unresist, so a drag taking hold mid-spring starts where the sheet is", () => {
    for (const down of [false, true]) {
      for (const offset of [-200, -10, 0, 10, 200]) {
        expect(unresist(resist(offset, 600, down), 600, down)).toBeCloseTo(offset);
      }
    }
  });
});

describe("scrimOpacity", () => {
  it("is fully dim at rest and clear with the sheet all the way down", () => {
    expect(scrimOpacity(0, 600)).toBe(1);
    expect(scrimOpacity("0%", 600)).toBe(1);
    expect(scrimOpacity(600, 600)).toBe(0);
    expect(scrimOpacity("100%", 600)).toBe(0);
  });

  it("lightens in step with the pull, in px or mid-entrance in percent", () => {
    expect(scrimOpacity(150, 600)).toBeCloseTo(0.75);
    expect(scrimOpacity("150px", 600)).toBeCloseTo(0.75);
    expect(scrimOpacity("25%", 600)).toBeCloseTo(0.75);
  });

  it("stays fully dim pulled up past rest, and clear past the bottom", () => {
    expect(scrimOpacity(-40, 600)).toBe(1);
    expect(scrimOpacity(900, 600)).toBe(0);
  });

  it("is fully dim at rest before the panel has been measured", () => {
    expect(scrimOpacity(0, 0)).toBe(1);
    // Still clear while it waits below the screen to rise.
    expect(scrimOpacity("100%", 0)).toBe(0);
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
    expect(releaseVelocity([], 1000)).toBe(0);
    expect(releaseVelocity([{ y: 40, t: 1000 }], 1000)).toBe(0);
    expect(releaseVelocity([{ y: 40, t: 1000 }], 1050)).toBe(0);
  });

  it("measures px/s over the last moments of the drag", () => {
    expect(
      releaseVelocity(
        [
          { y: 0, t: 1000 },
          { y: 20, t: 1050 },
          { y: 50, t: 1100 },
        ],
        1100,
      ),
    ).toBe(500);
  });

  it("ignores how fast the drag was earlier on", () => {
    // A fast start then a pause: only the pause counts at release.
    expect(
      releaseVelocity(
        [
          { y: 0, t: 0 },
          { y: 300, t: 50 },
          { y: 300, t: 400 },
          { y: 300, t: 450 },
        ],
        450,
      ),
    ).toBe(0);
  });

  it("is zero for a finger held still before it lifts, which sends no moves", () => {
    // 330 px/s, then 150 ms at rest with nothing reported.
    const moving = [
      { y: 100, t: 0 },
      { y: 117, t: 50 },
      { y: 133, t: 100 },
      { y: 150, t: 150 },
    ];
    expect(releaseVelocity(moving, 150)).toBe(330);
    expect(releaseVelocity(moving, 300)).toBe(0);
  });

  it("slows with a pause that falls inside the window", () => {
    // 50 px in the 50 ms before a 50 ms hold: half the speed it moved at.
    expect(
      releaseVelocity(
        [
          { y: 0, t: 0 },
          { y: 50, t: 50 },
        ],
        100,
      ),
    ).toBe(500);
  });

  it("is negative for a drag back up", () => {
    expect(
      releaseVelocity(
        [
          { y: 100, t: 0 },
          { y: 60, t: 80 },
        ],
        80,
      ),
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
  const ratio = (s: Spring) => s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  const response = (s: Spring) => (2 * Math.PI) / Math.sqrt(s.stiffness / s.mass);

  it("is built from a damping ratio and a response, in seconds", () => {
    const built = spring(0.8, 0.3, 120);
    expect(ratio(built)).toBeCloseTo(0.8);
    expect(response(built)).toBeCloseTo(0.3);
    expect(built.velocity).toBe(120);
    // Physical terms only: Motion drops the velocity of a spring given a
    // duration or a bounce.
    expect(built).not.toHaveProperty("duration");
    expect(built).not.toHaveProperty("visualDuration");
    expect(built).not.toHaveProperty("bounce");
  });

  it("opens and closes critically damped, from rest", () => {
    expect(ratio(SHEET_SPRING)).toBeCloseTo(1);
    expect(SHEET_SPRING.velocity).toBe(0);
  });

  it("throws a sheet away at the finger's speed, without a bounce", () => {
    expect(throwSpring(2400)).toEqual({ ...SHEET_SPRING, velocity: 2400 });
  });

  it("carries the finger's velocity back to rest, with a bounce only after a throw", () => {
    expect(ratio(settleSpring(200))).toBeCloseTo(1);
    expect(settleSpring(200).velocity).toBe(200);
    expect(ratio(settleSpring(-FLICK_VELOCITY))).toBeLessThan(1);
    expect(settleSpring(-FLICK_VELOCITY).velocity).toBe(-500);
  });
});
