import { afterEach, describe, expect, it, vi } from "vitest";
import { clearServiceWorkerCaches } from "@/lib/sw-client";
import { API_CACHE_NAME } from "@/lib/sw-cache-rules";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("still deletes the cache when no worker is registered", async () => {
    const remove = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
    });
    vi.stubGlobal("caches", { delete: remove });

    await clearServiceWorkerCaches();

    expect(remove).toHaveBeenCalledWith(API_CACHE_NAME);
  });

  it("does nothing in a browser without either API", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("caches", undefined);
    delete (globalThis as { caches?: unknown }).caches;

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });
});
