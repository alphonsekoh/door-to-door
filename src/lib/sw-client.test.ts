import { afterEach, describe, expect, it, vi } from "vitest";
import { clearServiceWorkerCaches } from "@/lib/sw-client";
import { API_CACHE_NAME } from "@/lib/sw-cache-rules";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Worker = { postMessage: (data: unknown, transfer: MessagePort[]) => void };
type Registration = { active: Worker | null; installing: object | null; waiting: object | null };

function withRegistration(registration: Partial<Registration> | undefined) {
  const remove = vi.fn(() => Promise.resolve(true));
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve(
          registration === undefined
            ? undefined
            : { active: null, installing: null, waiting: null, ...registration },
        ),
    },
  });
  vi.stubGlobal("caches", { delete: remove });
  return remove;
}

describe("clearServiceWorkerCaches", () => {
  it("asks an active worker and waits for its answer, leaving the cache to it", async () => {
    const asked: unknown[] = [];
    let answer: () => void = () => undefined;
    const remove = withRegistration({
      active: {
        postMessage: (data, [port]) => {
          asked.push(data);
          answer = () => port?.postMessage("CLEAR_CACHES");
        },
      },
    });
    let settled = false;
    const clearing = clearServiceWorkerCaches(60_000).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked).toEqual([{ type: "CLEAR_CACHES" }]);
    expect(settled).toBe(false);

    // The worker answers once it has deleted the cache.
    answer();
    await clearing;
    // Never both at once: on WebKit that could leave sign-in waiting for good.
    expect(remove).not.toHaveBeenCalled();
  });

  it("goes on without an answer from a worker that never gives one", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const remove = withRegistration({ active: { postMessage } });

    const clearing = clearServiceWorkerCaches(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(clearing).resolves.toBeUndefined();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it("leaves the cache alone while a first worker installs, as it has cached nothing", async () => {
    const remove = withRegistration({ installing: {} });
    await clearServiceWorkerCaches();
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the cache itself when no worker is registered", async () => {
    const remove = withRegistration(undefined);
    await clearServiceWorkerCaches();
    expect(remove).toHaveBeenCalledWith(API_CACHE_NAME);
  });

  it("deletes the cache itself when the registration has no worker left", async () => {
    const remove = withRegistration({});
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
