/*
 * Fixed-window rate limiting for sign-in attempts.
 *
 * In-memory, so the window is per process: it slows credential stuffing
 * against a single instance rather than providing a distributed guarantee.
 * Moving to a shared store means replacing consume(), reset() and refund():
 * sign-in clears an account's failures with reset() once it succeeds, and
 * gives back a charge with refund().
 *
 * Memory follows the live windows, not every key ever seen (#120). A window
 * is (re)inserted at the back of the Map whenever it starts, so the Map is in
 * expiry order and each consume() drops expired windows from the front until
 * it meets a live one. A hard cap on keys bounds a flood within one window.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type RateLimiter = {
  consume: (key: string) => RateLimitResult;
  reset: (key?: string) => void;
  refund: (key: string) => void;
  size: () => number;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
};

/* A memory guard rather than a policy, so a constant and not a config key (D-120-3). */
export const DEFAULT_MAX_KEYS = 100_000;

type Window = { count: number; expiresAt: number };

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, Window>();

  /* Drops windows from the front, oldest first, while they have expired or more than `keep` remain. */
  function trim(currentTime: number, keep: number): void {
    for (const [key, window] of windows) {
      if (window.expiresAt > currentTime && windows.size <= keep) {
        return;
      }
      windows.delete(key);
    }
  }

  /*
   * The clock can step backwards, which leaves an expired window behind a
   * live one where trim() does not reach it; so expiry is checked here too.
   */
  function live(key: string, currentTime: number): Window | undefined {
    const window = windows.get(key);
    return window !== undefined && window.expiresAt > currentTime ? window : undefined;
  }

  function consume(key: string): RateLimitResult {
    const currentTime = now();
    trim(currentTime, maxKeys);
    const existing = live(key, currentTime);

    if (existing === undefined) {
      windows.delete(key);
      trim(currentTime, maxKeys - 1);
      windows.set(key, { count: 1, expiresAt: currentTime + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterMs: existing.expiresAt - currentTime };
    }

    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
  }

  function reset(key?: string): void {
    if (key === undefined) {
      windows.clear();
      return;
    }
    windows.delete(key);
  }

  function refund(key: string): void {
    const existing = live(key, now());
    if (existing !== undefined) {
      existing.count = Math.max(0, existing.count - 1);
    }
  }

  return { consume, reset, refund, size: () => windows.size };
}
