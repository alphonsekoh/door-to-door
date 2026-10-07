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

/* Only a plain success is worth keeping: a 401 or 500 stored here would be
   served as if it were the answer, and a redirect or opaque response is not
   something the page can read. */
export function isStorableResponse(response: {
  status: number;
  redirected: boolean;
  type: string;
}): boolean {
  return response.status === 200 && !response.redirected && response.type !== "opaque";
}

export type StoredEntry<T> = { key: T; storedAt: number };

/* The oldest entries to drop to get back under the cap, by when each was last
   stored. The Cache API's own listing order is not a promise about recency. */
export function keysToEvict<T>(entries: readonly StoredEntry<T>[], maxEntries: number): T[] {
  const oldestFirst = [...entries].sort((a, b) => a.storedAt - b.storedAt);
  return oldestFirst.slice(0, Math.max(0, entries.length - maxEntries)).map(({ key }) => key);
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
