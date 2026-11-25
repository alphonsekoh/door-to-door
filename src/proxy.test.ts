import type { NextAuthConfig } from "next-auth";
import { describe, expect, it, vi } from "vitest";

/*
 * NextAuth is stubbed so auth() hands back the wrapped handler unchanged,
 * making the proxy callable directly with a request whose auth state we set.
 */
const { NextAuth, getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({
    authSecret: "s".repeat(40),
    auth: { trustHost: false, secureCookies: true },
  })),
  NextAuth: vi.fn((_config: NextAuthConfig | (() => NextAuthConfig)) => ({
    // The lazy form of NextAuth hands back a promise of the wrapped handler.
    auth: (handler: (request: unknown) => unknown) =>
      Promise.resolve((request: unknown) => handler(request)),
  })),
}));
vi.mock("next-auth", () => ({ default: NextAuth }));
vi.mock("@/server/config", () => ({ getConfig }));

const proxy = (await import("@/proxy")).default as unknown as (
  request: unknown,
) => Promise<Response>;

/*
 * Vitest 5 clears every mock's calls before each test (clearMocks), so what
 * the proxy did as it loaded is read here, before any test runs.
 */
const getConfigCallsAtImport = getConfig.mock.calls.length;
const authConfigAtImport = NextAuth.mock.calls[0]?.[0];

/* Builds the config from the factory the proxy gave NextAuth, as a request would. */
function buildAuthConfig(): NextAuthConfig {
  if (typeof authConfigAtImport !== "function") {
    throw new Error("the proxy gave NextAuth no config factory as it loaded");
  }
  return authConfigAtImport();
}

const request = (pathname: string, auth: unknown = null, search = "") => ({
  nextUrl: Object.assign(new URL(`https://test.local${pathname}${search}`), {
    pathname,
    search,
  }),
  auth,
});

const signedIn = { user: { id: "u1", role: "member" } };

describe("public paths", () => {
  it.each(["/sign-in", "/api/auth/session", "/api/auth/callback/credentials"])(
    "lets %s through unauthenticated",
    async (path) => {
      // Guarding these would make signing in impossible.
      expect((await proxy(request(path))).status).toBe(200);
    },
  );
});

describe("PWA files", () => {
  it.each(["/manifest.webmanifest", "/serwist/sw.js", "/serwist/sw.js.map", "/offline"])(
    "serves %s without a session",
    async (path) => {
      // The browser fetches these with no cookies; a redirect breaks installing
      // and makes the service worker's registration fail.
      expect((await proxy(request(path))).status).toBe(200);
    },
  );

  it.each(["/api/sessions/active", "/api/blocks", "/api/visits/sync", "/history"])(
    "still guards %s",
    async (path) => {
      expect((await proxy(request(path))).status).not.toBe(200);
    },
  );
});

describe("the retention job's trigger (#279)", () => {
  it("is answered by its own handler with no session, since it takes a bearer secret", async () => {
    // Sent no cookie, the scheduler would be turned away with a 401 before its secret was read.
    const response = await proxy(request("/api/retention/run"));
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("is that one path only", async () => {
    for (const path of ["/api/retention", "/api/retention/run/more", "/api/erasure-requests"]) {
      expect((await proxy(request(path))).status, path).toBe(401);
    }
  });
});

describe("unauthenticated visitors", () => {
  it("redirects a page request to sign-in", async () => {
    const response = await proxy(request("/history"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("preserves where they were going", async () => {
    // A member following a link to a unit should land on that unit.
    const response = await proxy(request("/history", null, "?block=123"));
    expect(response.headers.get("location")).toContain("callbackUrl=");
    expect(decodeURIComponent(response.headers.get("location") ?? "")).toContain(
      "/history?block=123",
    );
  });

  it("carries an old link's search term no further (#163)", async () => {
    const response = await proxy(request("/admin/records", null, "?q=Tan&interestLevel=high"));
    const location = decodeURIComponent(response.headers.get("location") ?? "");
    expect(location).toContain("/admin/records?interestLevel=high");
    expect(location).not.toContain("Tan");
  });

  it("answers an API request with 401 rather than an HTML redirect", async () => {
    // A fetch() could do nothing useful with a redirect to a sign-in page.
    const response = await proxy(request("/api/sessions"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });

  it("marks that 401 no-store, like every other API answer", async () => {
    const response = await proxy(request("/api/households"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("authenticated visitors", () => {
  it.each(["/history", "/api/sessions", "/"])("lets %s through", async (path) => {
    expect((await proxy(request(path, signedIn))).status).toBe(200);
  });
});

describe("configuration", () => {
  it("builds without the database adapter", () => {
    // Verifying a JWT needs no database, so the proxy opens no pool.
    expect(buildAuthConfig().adapter).toBeUndefined();
  });
});

describe("Auth.js configuration", () => {
  it("is built lazily, so importing the proxy reads no config file", () => {
    // `next build` imports this module; D-13-4 says it must need no file.
    expect(getConfigCallsAtImport).toBe(0);
  });

  it("takes its secret and trustHost from the loaded config", () => {
    expect(buildAuthConfig()).toMatchObject({ secret: "s".repeat(40), trustHost: false });
  });

  it.each([true, false])(
    "names the session cookie as auth.secureCookies: %s says, so it finds the one sign-in set",
    (secureCookies) => {
      getConfig.mockReturnValueOnce({
        authSecret: "s".repeat(40),
        auth: { trustHost: false, secureCookies },
      });
      expect(buildAuthConfig()).toMatchObject({ useSecureCookies: secureCookies });
    },
  );
});

describe("caching of signed-in pages", () => {
  it("marks a signed-in page no-store so Back after sign-out asks the server", async () => {
    const response = await proxy(request("/account", signedIn));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves API responses that set no cookie to their own handlers", async () => {
    const response = await proxy(request("/api/blocks", signedIn));
    expect(response.headers.get("cache-control")).toBeNull();
  });
});

describe("caching of the sign-in page (#150)", () => {
  it("marks /sign-in no-store, so a shared cache never keeps a copy", async () => {
    // A copy kept would reach later visitors without the CSRF cookie a first visit needs.
    const response = await proxy(request("/sign-in"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets a signed-out visitor read /privacy, no-store and with no redirect (#273)", async () => {
    const response = await proxy(request("/privacy"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("adds no Cache-Control of its own to an /api/auth answer that sets no cookie", async () => {
    const response = await proxy(request("/api/auth/session"));
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
