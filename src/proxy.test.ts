import { describe, expect, it, vi } from "vitest";

/*
 * NextAuth is stubbed so auth() hands back the wrapped handler unchanged,
 * making the proxy callable directly with a request whose auth state we set.
 */
const { NextAuth } = vi.hoisted(() => ({
  NextAuth: vi.fn((_config: unknown) => ({
    auth: (handler: (request: unknown) => unknown) => handler,
  })),
}));
vi.mock("next-auth", () => ({ default: NextAuth }));

const proxy = (await import("@/proxy")).default as unknown as (request: unknown) => Response;

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
    (path) => {
      // Guarding these would make signing in impossible.
      expect(proxy(request(path)).status).toBe(200);
    },
  );
});

describe("unauthenticated visitors", () => {
  it("redirects a page request to sign-in", () => {
    const response = proxy(request("/history"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("preserves where they were going", () => {
    // A member following a link to a unit should land on that unit.
    const response = proxy(request("/history", null, "?block=123"));
    expect(response.headers.get("location")).toContain("callbackUrl=");
    expect(decodeURIComponent(response.headers.get("location") ?? "")).toContain(
      "/history?block=123",
    );
  });

  it("answers an API request with 401 rather than an HTML redirect", async () => {
    // A fetch() could do nothing useful with a redirect to a sign-in page.
    const response = proxy(request("/api/sessions"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("authenticated visitors", () => {
  it.each(["/history", "/api/sessions", "/"])("lets %s through", (path) => {
    expect(proxy(request(path, signedIn)).status).toBe(200);
  });
});

describe("configuration", () => {
  it("builds without the database adapter, so it can run on the edge", () => {
    // pg cannot load in the edge runtime; verifying a JWT needs no database.
    const config = NextAuth.mock.calls[0]?.[0] as { adapter?: unknown } | undefined;
    expect(config?.adapter).toBeUndefined();
  });
});
