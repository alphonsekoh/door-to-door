import { describe, expect, it } from "vitest";
import {
  approximateMinutes,
  checkNotAhead,
  checkNotBefore,
  checkWithinTolerance,
  type Clock,
} from "@/lib/clock";

const now = new Date("2026-06-01T12:00:00.000Z");
const clock: Clock = { now, toleranceMs: 300_000 };
const at = (offsetMs: number, base = now) => new Date(base.getTime() + offsetMs);

describe("checkNotAhead", () => {
  it("accepts exactly at the tolerance", () => {
    expect(checkNotAhead(at(300_000), clock)).toBeNull();
  });
  it("rejects just beyond it", () => {
    expect(checkNotAhead(at(300_001), clock)).toEqual({ kind: "ahead", differenceMs: 300_001 });
  });
  it("accepts any past value", () => {
    expect(checkNotAhead(at(-86_400_000), clock)).toBeNull();
  });
});

describe("checkNotBefore", () => {
  it("accepts exactly at floor minus tolerance", () => {
    expect(checkNotBefore(at(-300_000), now, clock)).toBeNull();
  });
  it("rejects just earlier", () => {
    expect(checkNotBefore(at(-300_001), now, clock)).toEqual({
      kind: "behind",
      differenceMs: 300_001,
    });
  });
  it("accepts values after the floor", () => {
    expect(checkNotBefore(at(3_600_000), now, clock)).toBeNull();
  });
});

describe("checkWithinTolerance", () => {
  it("accepts exactly at the tolerance either way", () => {
    expect(checkWithinTolerance(at(300_000), clock)).toBeNull();
    expect(checkWithinTolerance(at(-300_000), clock)).toBeNull();
  });
  it("rejects just beyond it, naming the direction", () => {
    expect(checkWithinTolerance(at(300_001), clock)?.kind).toBe("ahead");
    expect(checkWithinTolerance(at(-300_001), clock)?.kind).toBe("behind");
  });
});

describe("approximateMinutes", () => {
  it("rounds up and ignores sign", () => {
    expect(approximateMinutes(300_001)).toBe(6);
    expect(approximateMinutes(-3_600_000)).toBe(60);
  });
  it("never reports zero", () => {
    expect(approximateMinutes(1)).toBe(1);
  });
});
