import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/server/auth/rate-limit";

/* Controllable clock, so the window is tested without waiting on real time. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("createRateLimiter", () => {
  it("allows attempts up to the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: fakeClock().now });
    expect([1, 2, 3].map(() => limiter.consume("a").allowed)).toEqual([true, true, true]);
  });

  it("blocks the attempt after the limit", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("counts down the remaining attempts", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: fakeClock().now });
    expect(limiter.consume("a").remaining).toBe(2);
    expect(limiter.consume("a").remaining).toBe(1);
    expect(limiter.consume("a").remaining).toBe(0);
  });

  it("reports how long until the window reopens", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 5000, now: clock.now });
    limiter.consume("a");
    clock.advance(2000);
    expect(limiter.consume("a").retryAfterMs).toBe(3000);
  });

  it("keeps separate budgets per key", () => {
    // One attacker hammering one account must not lock everyone else out.
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    limiter.consume("alice@example.com");
    expect(limiter.consume("ben@example.com").allowed).toBe(true);
  });

  it("reopens once the window elapses", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);
    clock.advance(1001);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("treats a window expiring exactly now as reopened", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.consume("a");
    clock.advance(1000);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("resets one key", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.reset("a");
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("resets every key when given none", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.consume("b");
    limiter.reset();
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("defaults to the real clock", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });
});
