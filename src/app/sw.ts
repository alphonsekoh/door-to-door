/// <reference lib="webworker" />
import { NetworkOnly, Serwist, StaleWhileRevalidate, type PrecacheEntry } from "serwist";
import { createBoundedCachePlugin } from "@/lib/sw-api-cache";
import {
  API_CACHE_NAME,
  SW_MESSAGES,
  isApiRequest,
  isCacheableApiGet,
  messageType,
} from "@/lib/sw-cache-rules";

/*
 * The offline shell, and nothing more.
 *
 * Precached: the hashed bundles, the icons and /offline. Not cached: any HTML
 * for a signed-in page (it is per-member), any write, anything under
 * /api/auth, and every API GET except the short allow-list in sw-cache-rules.
 * This worker never reads or writes IndexedDB.
 *
 * A navigation that fails gets /offline, at the address that failed: that
 * page is the offline recording shell (#77), which reads the member's local
 * copy and the queue from IndexedDB itself, in the page.
 */

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[];
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new version waits until the member agrees (update-prompt), so a deploy
  // never swaps code under a half-filled form.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ request, url }) => isCacheableApiGet(url, request.method),
      handler: new StaleWhileRevalidate({
        cacheName: API_CACHE_NAME,
        plugins: [createBoundedCachePlugin()],
      }),
    },
    {
      matcher: ({ url }) => isApiRequest(url),
      handler: new NetworkOnly(),
    },
    {
      // Routed only so a failed navigation reaches the /offline fallback;
      // the page itself always comes from the network.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

self.addEventListener("message", (event) => {
  if (messageType(event.data) === SW_MESSAGES.clearCaches) {
    /* Answered once done, failed or not: the page waits for this rather than
       deleting the same cache itself at the same moment (sw-client). */
    const [answer] = event.ports;
    event.waitUntil(
      caches.delete(API_CACHE_NAME).finally(() => {
        answer?.postMessage(SW_MESSAGES.clearCaches);
      }),
    );
  }
});

serwist.addEventListeners();
