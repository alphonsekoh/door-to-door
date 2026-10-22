import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoundedCachePlugin } from "@/lib/pwa/sw-api-cache";
import { CACHED_AT_HEADER } from "@/lib/pwa/sw-cache-rules";

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

  it.each([
    ["a 401", () => new Response("{}", { status: 401 })],
    ["a 500", () => new Response("{}", { status: 500 })],
    ["an opaque response", () => Response.error()],
  ])("refuses to store %s", async (_name, make) => {
    const { cacheWillUpdate } = hooks(createBoundedCachePlugin());
    expect(await cacheWillUpdate({ response: make() } as never)).toBeNull();
  });

  it("refuses to store a response that followed a redirect", async () => {
    const { cacheWillUpdate } = hooks(createBoundedCachePlugin());
    const response = new Response("<html>", { status: 200 });
    Object.defineProperty(response, "redirected", { value: true });
    expect(await cacheWillUpdate({ response } as never)).toBeNull();
  });

  it("evicts by when an entry was stored, not by listing order", async () => {
    const stamped = (stamp?: number) =>
      new Response(
        "x",
        stamp === undefined ? {} : { headers: { [CACHED_AT_HEADER]: String(stamp) } },
      );
    // Listed oldest-first by key, but "a" was refreshed most recently.
    const stored = new Map<Request, Response>([
      [new Request("https://app.test/api/blocks?a"), stamped(900)],
      [new Request("https://app.test/api/blocks?b"), stamped(100)],
      [new Request("https://app.test/api/blocks?c"), stamped(500)],
      [new Request("https://app.test/api/blocks?d"), stamped()],
    ]);
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      open: () =>
        Promise.resolve({
          keys: () => Promise.resolve([...stored.keys()]),
          match: (key: Request) => Promise.resolve(stored.get(key)),
          delete: (key: Request) => {
            deleted.push(new URL(key.url).search);
            return Promise.resolve(true);
          },
        }),
    });

    const { cacheDidUpdate } = hooks(createBoundedCachePlugin(Date.now, 1_000, 2));
    await cacheDidUpdate({ cacheName: "api" } as never);

    // The unstamped entry and the oldest stamped one go; the refreshed "a" stays.
    expect(deleted.sort()).toEqual(["?b", "?d"]);
  });
});
