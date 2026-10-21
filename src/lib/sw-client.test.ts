import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEAR_WITHIN_MS, clearServiceWorkerCaches } from "@/lib/sw-client";
import { API_CACHE_NAME } from "@/lib/sw-cache-rules";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const never = () => new Promise<never>(() => undefined);

/* Whether the clear has finished, checked without letting any time pass. */
function watch(clearing: Promise<void>): () => boolean {
  let settled = false;
  void clearing.then(() => {
    settled = true;
  });
  return () => settled;
}

describe("clearServiceWorkerCaches", () => {
  it("tells the worker and deletes the API cache itself", async () => {
    const postMessage = vi.fn();
    const remove = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => Promise.resolve({ active: { postMessage } }) },
    });
    vi.stubGlobal("caches", { delete: remove });

    await clearServiceWorkerCaches();

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHES" });
    expect(remove).toHaveBeenCalledWith(API_CACHE_NAME);
  });

  it("still deletes the cache when no worker is registered, or none is active", async () => {
    const remove = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("caches", { delete: remove });
    for (const registration of [undefined, { active: null }]) {
      vi.stubGlobal("navigator", {
        serviceWorker: { getRegistration: () => Promise.resolve(registration) },
      });
      await clearServiceWorkerCaches();
    }
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(API_CACHE_NAME);
  });

  it("does nothing in a browser without either API", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("caches", undefined);
    delete (globalThis as { caches?: unknown }).caches;

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });

  it("finishes as soon as the cache is gone, not at the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
    });
    vi.stubGlobal("caches", { delete: () => Promise.resolve(true) });

    const done = watch(clearServiceWorkerCaches());
    await vi.advanceTimersByTimeAsync(0);
    expect(done()).toBe(true);
  });

  it("goes on when the browser never says which worker is registered", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: never } });
    vi.stubGlobal("caches", { delete: vi.fn(() => Promise.resolve(true)) });

    const done = watch(clearServiceWorkerCaches());
    await vi.advanceTimersByTimeAsync(CLEAR_WITHIN_MS - 1);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });

  it("goes on when deleting the cache never finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
    });
    vi.stubGlobal("caches", { delete: never });

    const done = watch(clearServiceWorkerCaches(500));
    await vi.advanceTimersByTimeAsync(499);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });

  it("passes a failure on, for the caller to go on without", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("caches", { delete: () => Promise.reject(new Error("storage is gone")) });

    await expect(clearServiceWorkerCaches()).rejects.toThrow("storage is gone");
  });
});
