import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoundedCachePlugin } from "@/lib/sw-api-cache";
import { CACHED_AT_HEADER } from "@/lib/sw-cache-rules";

afterEach(() => {
  vi.unstubAllGlobals();
});

function hooks(plugin: ReturnType<typeof createBoundedCachePlugin>) {
  const { cacheWillUpdate, cachedResponseWillBeUsed, cacheDidUpdate } = plugin;
  if (!cacheWillUpdate || !cachedResponseWillBeUsed || !cacheDidUpdate) {
    throw new Error("plugin is missing a hook");
  }
  return { cacheWillUpdate, cachedResponseWillBeUsed, cacheDidUpdate };
}

describe("the bounded API cache", () => {
  it("stamps what it stores, keeping the body and status", async () => {
    const { cacheWillUpdate } = hooks(createBoundedCachePlugin(() => 5_000));
    const stored = (await cacheWillUpdate({
      response: new Response('{"a":1}', { status: 200, headers: { "x-keep": "yes" } }),
    } as never)) as Response;

    expect(stored.headers.get(CACHED_AT_HEADER)).toBe("5000");
    expect(stored.headers.get("x-keep")).toBe("yes");
    expect(stored.status).toBe(200);
    expect(await stored.text()).toBe('{"a":1}');
  });

  it("serves an entry while it is fresh and drops it once it is too old", () => {
    let clock = 10_000;
    const { cachedResponseWillBeUsed } = hooks(createBoundedCachePlugin(() => clock, 1_000, 20));
    const entry = new Response("x", { headers: { [CACHED_AT_HEADER]: "10000" } });

    clock = 11_000;
    expect(cachedResponseWillBeUsed({ cachedResponse: entry } as never)).toBe(entry);
    clock = 11_001;
    expect(cachedResponseWillBeUsed({ cachedResponse: entry } as never)).toBeNull();
  });

  it("does not trust an entry it did not stamp", () => {
    const { cachedResponseWillBeUsed } = hooks(createBoundedCachePlugin());
    expect(cachedResponseWillBeUsed({ cachedResponse: new Response("x") } as never)).toBeNull();
    expect(cachedResponseWillBeUsed({ cachedResponse: undefined } as never)).toBeNull();
  });

  it("evicts the oldest entries past the cap", async () => {
    const keys = ["a", "b", "c"].map((id) => new Request(`https://app.test/api/blocks?${id}`));
    const deleted: Request[] = [];
    vi.stubGlobal("caches", {
      open: () =>
        Promise.resolve({
          keys: () => Promise.resolve(keys),
          delete: (key: Request) => {
            deleted.push(key);
            return Promise.resolve(true);
          },
        }),
    });

    const { cacheDidUpdate } = hooks(createBoundedCachePlugin(Date.now, 1_000, 2));
    await cacheDidUpdate({ cacheName: "api" } as never);

    expect(deleted).toEqual([keys[0]]);
  });
});
