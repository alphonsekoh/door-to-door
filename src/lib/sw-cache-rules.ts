/*
 * What the service worker may keep, as plain functions so the rules are
 * testable without a worker.
 *
 * The default is to keep nothing. An API GET is cached only if it is listed
 * here, because a stale answer from the wrong endpoint is worse than no answer:
 * a cached GET /sessions/active would keep showing an outing the admin has
 * already ended, and a member would record visits into it.
 */

export const API_CACHE_NAME = "api-reference-v1";
export const API_CACHE_MAX_ENTRIES = 20;
export const API_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CACHED_AT_HEADER = "x-sw-cached-at";

/* Reference data that changes rarely: the list of blocks. Everything about an
   outing, a household, a visit or a follow-up is live state and stays off. */
const CACHEABLE_API_PATHS: readonly string[] = ["/api/blocks"];

export function isCacheableApiGet(url: URL, method: string): boolean {
  return method === "GET" && CACHEABLE_API_PATHS.includes(url.pathname);
}

export function isApiRequest(url: URL): boolean {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

export function isFresh(cachedAt: number, now: number, maxAgeMs: number): boolean {
  return now - cachedAt <= maxAgeMs;
}

/* The oldest entries to drop to get back under the cap. Keys arrive in
   insertion order, which is the order the Cache API lists them in. */
export function keysToEvict<T>(keys: readonly T[], maxEntries: number): T[] {
  return keys.slice(0, Math.max(0, keys.length - maxEntries));
}

/* Messages the page sends the worker. */
export const SW_MESSAGES = {
  skipWaiting: "SKIP_WAITING",
  clearCaches: "CLEAR_CACHES",
} as const;

export type SwMessageType = (typeof SW_MESSAGES)[keyof typeof SW_MESSAGES];

export function messageType(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("type" in data)) return null;
  return typeof data.type === "string" ? data.type : null;
}
