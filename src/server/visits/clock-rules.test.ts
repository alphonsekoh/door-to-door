import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({ sync: { clockSkewToleranceSeconds: 300 } })),
}));
vi.mock("@/server/config", () => ({ getConfig }));

const { assertBatchClockSane, assertNotBeforeOuting, assertNotInFuture, currentClock } =
  await import("@/server/visits/clock-rules");

const now = new Date("2026-06-01T12:00:00.000Z");
const clock = { now, toleranceMs: 300_000 };
const at = (ms: number, base = now) => new Date(base.getTime() + ms);

beforeEach(() => {
  getConfig.mockClear();
});

describe("currentClock", () => {
  it("reads the tolerance from config on every call, in milliseconds", () => {
    expect(currentClock().toleranceMs).toBe(300_000);
    getConfig.mockReturnValue({ sync: { clockSkewToleranceSeconds: 60 } });
    expect(currentClock().toleranceMs).toBe(60_000);
    expect(currentClock().now.getTime()).toBeGreaterThan(0);
  });
});

describe("assertNotInFuture", () => {
  it("passes at the tolerance and refuses beyond it with the difference", () => {
    expect(() => {
      assertNotInFuture(at(300_000), clock);
    }).not.toThrow();
    expect(() => {
      assertNotInFuture(at(600_000), clock);
    }).toThrow(/about 10 minutes ahead/);
  });
});

describe("assertNotBeforeOuting", () => {
  it("passes at the tolerance and refuses beyond it", () => {
    expect(() => {
      assertNotBeforeOuting(at(-300_000), now, clock);
    }).not.toThrow();
    expect(() => {
      assertNotBeforeOuting(at(-3_600_000), now, clock);
    }).toThrow(/about 60 minutes before its outing began/);
  });
});

describe("assertBatchClockSane", () => {
  it("passes at the tolerance either way", () => {
    expect(() => {
      assertBatchClockSane(at(300_000), clock);
    }).not.toThrow();
    expect(() => {
      assertBatchClockSane(at(-300_000), clock);
    }).not.toThrow();
  });
  it("names the direction when beyond it", () => {
    expect(() => {
      assertBatchClockSane(at(900_000), clock);
    }).toThrow(/15 minutes ahead of/);
    expect(() => {
      assertBatchClockSane(at(-900_000), clock);
    }).toThrow(/15 minutes behind/);
  });
  it("does not leak internals", () => {
    expect(() => {
      assertBatchClockSane(at(900_000), clock);
    }).not.toThrow(/config|yaml|sentAt/i);
  });
});
