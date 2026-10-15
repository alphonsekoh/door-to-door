import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, retryDelay } from "@/lib/sync/backoff";

describe("retryDelay", () => {
  it("doubles from five seconds", () => {
    expect([1, 2, 3, 4].map((n) => retryDelay(n, () => 1))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it("caps at five minutes", () => {
    expect(retryDelay(7, () => 1)).toBe(300_000);
    expect(retryDelay(30, () => 1)).toBe(300_000);
  });

  it("spreads each delay anywhere from nothing up to the ceiling", () => {
    expect(retryDelay(3, () => 0)).toBe(0);
    expect(retryDelay(3, () => 0.25)).toBe(5_000);
  });

  it("gives a failing record at most about ten minutes before it is quarantined", () => {
    const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => retryDelay(i + 1, () => 1));
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(615_000);
  });
});
