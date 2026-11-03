import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_KEYS, createRateLimiter } from "@/server/auth/rate-limit";

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

  it("restores the full budget when a key is reset mid-window", () => {
    // Sign-in clears an account's failures this way once it succeeds (#86).
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });
    limiter.consume("a");
    limiter.consume("a");
    clock.advance(500);
    limiter.reset("a");
    expect([1, 2, 3, 4].map(() => limiter.consume("a").allowed)).toEqual([true, true, true, false]);
  });

  it("leaves other keys' spent budgets spent when one key is reset", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.consume("b");
    limiter.reset("a");
    expect(limiter.consume("b").allowed).toBe(false);
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

describe("memory (#120)", () => {
  it("lets go of every expired window on the next attempt", () => {
    // The reported leak: every distinct email stayed in the Map until a restart.
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });
    for (let i = 0; i < 10_000; i += 1) {
      limiter.consume(`attacker-${String(i)}@example.com`);
    }
    expect(limiter.size()).toBe(10_000);

    clock.advance(1000);
    limiter.consume("member@example.com");
    expect(limiter.size()).toBe(1);
  });

  it("sweeps on an attempt for a key it already holds, too", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });
    for (let i = 0; i < 100; i += 1) {
      limiter.consume(`attacker-${String(i)}@example.com`);
    }
    clock.advance(500);
    limiter.consume("member@example.com");
    clock.advance(500);

    expect(limiter.consume("member@example.com").remaining).toBe(1);
    expect(limiter.size()).toBe(1);
  });

  it("drops only the windows that have expired, and live counts survive it", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });
    limiter.consume("old");
    clock.advance(600);
    limiter.consume("live");
    limiter.consume("live");
    clock.advance(400);

    limiter.consume("new");
    expect(limiter.size()).toBe(2);
    expect(limiter.consume("live").allowed).toBe(false);
  });

  it("keeps a reopened window until its new expiry, while older ones go", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.consume("a");
    clock.advance(500);
    limiter.consume("b");
    clock.advance(500);
    limiter.consume("a");
    clock.advance(600);

    limiter.consume("c");
    expect(limiter.size()).toBe(2);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("never holds more than maxKeys, evicting the oldest window first", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 3,
      now: fakeClock().now,
    });
    for (const key of ["a", "b", "c", "d"]) {
      limiter.consume(key);
      expect(limiter.size()).toBeLessThanOrEqual(3);
    }
    expect(limiter.size()).toBe(3);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("c").allowed).toBe(false);
    expect(limiter.consume("d").allowed).toBe(false);
  });

  it("does not evict anything for a key it already holds", () => {
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 1000,
      maxKeys: 2,
      now: fakeClock().now,
    });
    limiter.consume("a");
    limiter.consume("b");
    limiter.consume("b");
    expect(limiter.size()).toBe(2);
    expect(limiter.consume("a").remaining).toBe(1);
  });

  it("caps at 100,000 keys by default", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    for (let i = 0; i <= DEFAULT_MAX_KEYS; i += 1) {
      limiter.consume(String(i));
    }
    expect(DEFAULT_MAX_KEYS).toBe(100_000);
    expect(limiter.size()).toBe(DEFAULT_MAX_KEYS);
  });

  it("still treats an expired window as reopened when the clock has stepped back", () => {
    // After a backwards step a short-lived window sits behind a longer-lived
    // one, where the sweep stops before reaching it.
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.consume("before");
    clock.advance(-800);
    limiter.consume("after");
    clock.advance(1000);

    expect(limiter.consume("after").allowed).toBe(true);
    expect(limiter.consume("before").allowed).toBe(false);
  });

  it("moves a reopened window to the back, so the cap does not evict a live one for it", () => {
    // Left where it was, the reopened window would be the "oldest" and the
    // window in front of it would be evicted to make room for a key already held.
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: clock.now });
    limiter.consume("before");
    clock.advance(-800);
    limiter.consume("after");
    clock.advance(1000);

    limiter.consume("after");
    expect(limiter.size()).toBe(2);
    expect(limiter.consume("before").allowed).toBe(false);
  });
});

describe("refund", () => {
  it("gives back one attempt and leaves the rest counted", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.consume("a");
    limiter.refund("a");
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("never takes the count below zero", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: fakeClock().now });
    limiter.consume("a");
    limiter.refund("a");
    limiter.refund("a");
    limiter.refund("a");
    expect([1, 2, 3].map(() => limiter.consume("a").allowed)).toEqual([true, true, false]);
  });

  it("does nothing for a key it has never seen", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: fakeClock().now });
    limiter.refund("a");
    expect(limiter.size()).toBe(0);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("does nothing for an expired window, which the next attempt reopens in full", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });
    limiter.consume("a");
    limiter.consume("a");
    clock.advance(1000);
    limiter.refund("a");
    expect([1, 2, 3].map(() => limiter.consume("a").allowed)).toEqual([true, true, false]);
  });
});
