import type { SerwistPlugin } from "serwist";
import {
  API_CACHE_MAX_AGE_MS,
  API_CACHE_MAX_ENTRIES,
  CACHED_AT_HEADER,
  isFresh,
  isStorableResponse,
  keysToEvict,
} from "@/lib/pwa/sw-cache-rules";

/*
 * Bounds the API cache by age and size without Serwist's ExpirationPlugin,
 * which keeps its bookkeeping in IndexedDB. The worker must never touch
 * IndexedDB: the unsynced write queue (#33) lives there and has to survive a
 * deploy untouched. The cache is its own bookkeeping instead - each entry is
 * stamped with when it was stored.
 */

export function createBoundedCachePlugin(
  now: () => number = Date.now,
  maxAgeMs = API_CACHE_MAX_AGE_MS,
  maxEntries = API_CACHE_MAX_ENTRIES,
): SerwistPlugin {
  return {
    cacheWillUpdate: ({ response }) => {
      if (!isStorableResponse(response)) return null;
      const headers = new Headers(response.headers);
      headers.set(CACHED_AT_HEADER, String(now()));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },

    cachedResponseWillBeUsed: ({ cachedResponse }) => {
      const stamp = Number(cachedResponse?.headers.get(CACHED_AT_HEADER));
      // Unstamped means it was not stored by this plugin; do not trust it.
      if (!Number.isFinite(stamp) || stamp === 0) return null;
      return isFresh(stamp, now(), maxAgeMs) ? cachedResponse : null;
    },

    cacheDidUpdate: async ({ cacheName }) => {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const entries = await Promise.all(
        keys.map(async (key) => ({
          key,
          // Unstamped counts as the oldest, so it goes first.
          storedAt: Number((await cache.match(key))?.headers.get(CACHED_AT_HEADER)) || 0,
        })),
      );
      await Promise.all(keysToEvict(entries, maxEntries).map((key) => cache.delete(key)));
    },
  };
}
