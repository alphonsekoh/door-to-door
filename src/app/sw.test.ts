import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

type Rule = {
  matcher: (context: { request: { method: string; mode: string }; url: URL }) => boolean;
  handler: {
    kind: string;
    options?: { cacheName: string; plugins: { cacheWillUpdate: (p: unknown) => unknown }[] };
  };
};
type Options = {
  precacheEntries: string[];
  skipWaiting: boolean;
  clientsClaim: boolean;
  runtimeCaching: Rule[];
  fallbacks: { entries: { url: string; matcher: (c: { request: { mode: string } }) => boolean }[] };
};

const { captured } = vi.hoisted(
  (): { captured: { options: unknown; addEventListeners: Mock } } => ({
    captured: { options: undefined, addEventListeners: vi.fn() },
  }),
);

vi.mock("serwist", () => ({
  Serwist: class {
    constructor(options: unknown) {
      captured.options = options;
    }
    addEventListeners = captured.addEventListeners;
  },
  NetworkOnly: class {
    kind = "network-only";
  },
  StaleWhileRevalidate: class {
    kind = "stale-while-revalidate";
    constructor(
      public options: {
        cacheName: string;
        plugins: { cacheWillUpdate: (p: unknown) => unknown }[];
      },
    ) {}
  },
}));

const messageListeners: ((event: {
  data: unknown;
  ports: { postMessage: (message: unknown) => void }[];
  waitUntil: (p: Promise<unknown>) => void;
}) => void)[] = [];
const deleteCache = vi.fn((_name: string) => Promise.resolve(true));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  messageListeners.length = 0;
  vi.stubGlobal("self", {
    __SW_MANIFEST: ["/offline", "/icon-192.png"],
    addEventListener: (_type: string, listener: (typeof messageListeners)[number]) =>
      messageListeners.push(listener),
  });
  vi.stubGlobal("caches", { delete: deleteCache });
  await import("@/app/sw");
});

const options = (): Options => captured.options as Options;
const ctx = (path: string, method = "GET", mode = "cors") => ({
  request: { method, mode },
  url: new URL(path, "https://app.test"),
});
const handlerFor = (path: string, method = "GET", mode = "cors") =>
  options().runtimeCaching.find((rule) => rule.matcher(ctx(path, method, mode)))?.handler.kind;

describe("the service worker", () => {
  it("precaches the manifest and waits for the member before updating", () => {
    expect(options().precacheEntries).toEqual(["/offline", "/icon-192.png"]);
    expect(options().skipWaiting).toBe(false);
    expect(options().clientsClaim).toBe(false);
    expect(captured.addEventListeners).toHaveBeenCalledOnce();
  });

  it("serves the block list stale-while-revalidate from its own cache", () => {
    expect(handlerFor("/api/blocks")).toBe("stale-while-revalidate");
    const rule = options().runtimeCaching[0];
    expect(rule?.handler.options?.cacheName).toBe("api-reference-v1");
  });

  it("wires in the real bounded cache, which refuses error responses", async () => {
    const [plugin] = options().runtimeCaching[0]?.handler.options?.plugins ?? [];
    expect(
      await plugin?.cacheWillUpdate({ response: new Response("{}", { status: 401 }) }),
    ).toBeNull();
    const stored = await plugin?.cacheWillUpdate({ response: new Response("{}", { status: 200 }) });
    expect(stored).toBeInstanceOf(Response);
  });

  it.each(["/api/sessions/active", "/api/follow-ups", "/api/history", "/api/auth/session"])(
    "sends %s straight to the network, never the cache",
    (path) => {
      expect(handlerFor(path)).toBe("network-only");
    },
  );

  it("never caches a write, even to a cacheable path", () => {
    expect(handlerFor("/api/blocks", "POST")).toBe("network-only");
    expect(handlerFor("/api/visits/sync", "POST")).toBe("network-only");
  });

  it("fetches pages from the network and falls back to /offline", () => {
    expect(handlerFor("/history", "GET", "navigate")).toBe("network-only");
    const [fallback] = options().fallbacks.entries;
    expect(fallback?.url).toBe("/offline");
    expect(fallback?.matcher({ request: { mode: "navigate" } })).toBe(true);
    expect(fallback?.matcher({ request: { mode: "cors" } })).toBe(false);
  });

  it("does not handle ordinary subresource requests itself", () => {
    expect(handlerFor("/some-image-that-is-not-precached")).toBeUndefined();
  });

  it("clears the API cache when the page asks, and only then, and says when it is done", async () => {
    const [listener] = messageListeners;
    const waitUntil = vi.fn<(p: Promise<unknown>) => void>();
    const answer = { postMessage: vi.fn() };

    listener?.({ data: { type: "SOMETHING_ELSE" }, ports: [answer], waitUntil });
    expect(deleteCache).not.toHaveBeenCalled();

    listener?.({ data: { type: "CLEAR_CACHES" }, ports: [answer], waitUntil });
    expect(deleteCache).toHaveBeenCalledWith("api-reference-v1");
    expect(answer.postMessage).not.toHaveBeenCalled();
    await waitUntil.mock.calls[0]?.[0];
    expect(answer.postMessage).toHaveBeenCalledWith("CLEAR_CACHES");
  });

  it("answers even when the cache could not be deleted, so the page is not kept waiting", async () => {
    const [listener] = messageListeners;
    const waitUntil = vi.fn<(p: Promise<unknown>) => void>();
    const answer = { postMessage: vi.fn() };
    deleteCache.mockRejectedValueOnce(new Error("storage is gone"));

    listener?.({ data: { type: "CLEAR_CACHES" }, ports: [answer], waitUntil });
    await waitUntil.mock.calls[0]?.[0]?.catch(() => undefined);
    expect(answer.postMessage).toHaveBeenCalledWith("CLEAR_CACHES");
  });

  it("clears for a page that asks without waiting for the answer", () => {
    const [listener] = messageListeners;
    const waitUntil = vi.fn();
    listener?.({ data: { type: "CLEAR_CACHES" }, ports: [], waitUntil });
    expect(deleteCache).toHaveBeenCalledWith("api-reference-v1");
  });
});

describe("the worker's reach", () => {
  const files = ["src/app/sw.ts", "src/lib/sw-api-cache.ts", "src/lib/sw-cache-rules.ts"];

  it.each(files)("%s never touches IndexedDB", (file) => {
    // The unsynced write queue (#33) lives in IndexedDB and must survive every
    // deploy. Serwist's ExpirationPlugin keeps its own bookkeeping there, so
    // it is out too.
    const withComments = readFileSync(join(process.cwd(), file), "utf8");
    const source = withComments.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/indexedDB|IDBDatabase|from "idb"|ExpirationPlugin/);
  });
});
