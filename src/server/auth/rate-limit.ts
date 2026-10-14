/*
 * Fixed-window rate limiting for sign-in attempts.
 *
 * In-memory, so the window is per process: it slows credential stuffing
 * against a single instance rather than providing a distributed guarantee.
 * Moving to a shared store means replacing consume() and reset(), which
 * sign-in uses to clear an account's failures once it succeeds.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type RateLimiter = {
  consume: (key: string) => RateLimitResult;
  reset: (key?: string) => void;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, { count: number; expiresAt: number }>();

  function consume(key: string): RateLimitResult {
    const currentTime = now();
    const existing = windows.get(key);

    if (!existing || existing.expiresAt <= currentTime) {
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

  return { consume, reset };
}
