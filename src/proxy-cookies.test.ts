import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The real Auth.js wrapper, not a stub: what matters here is the Set-Cookie
 * header it adds, which a stubbed NextAuth cannot show.
 */
const SECRET = "s".repeat(40);
vi.mock("@/server/config", () => ({
  getConfig: () => ({
    authSecret: SECRET,
    auth: { trustHost: true, secureCookies: true },
  }),
}));

const { default: proxy } = await import("@/proxy");

const event = {} as NextFetchEvent;

async function cookielessGet(path: string): Promise<Response> {
  const response = await proxy(new NextRequest(`http://127.0.0.1:3210${path}`), event);
  if (!(response instanceof Response)) throw new Error(`no response for ${path}`);
  return response;
}

const csrfCookies = (response: Response) =>
  response.headers.getSetCookie().filter((cookie) => cookie.includes("csrf-token"));

describe("cookies the proxy sets", () => {
  /*
   * WebKit fetches the service worker script for its update check without
   * cookies, and stores what the response sets. A CSRF token minted there
   * replaced the member's own, so a sign-out a moment later was refused.
   */
  it.each(["/serwist/sw.js", "/serwist/sw.js.map", "/manifest.webmanifest", "/offline"])(
    "mints no CSRF token on a cookieless request for %s",
    async (path) => {
      const response = await cookielessGet(path);
      expect(response.status).toBe(200);
      expect(csrfCookies(response)).toEqual([]);
    },
  );

  it("hands a first visit to /sign-in its CSRF cookie with the page", async () => {
    // Otherwise the form's first session and csrf requests each mint their
    // own, and whichever lands last no longer matches the token it sends.
    const response = await cookielessGet("/sign-in");
    expect(response.status).toBe(200);
    expect(csrfCookies(response)).toHaveLength(1);
  });

  it("still guards a page, with the real Auth.js underneath", async () => {
    const response = await cookielessGet("/history");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });
});

describe("caching of what the proxy sets a cookie on (#150)", () => {
  const ORIGIN = "http://127.0.0.1:3210";
  const SESSION = "__Secure-authjs.session-token";

  /* name=value from each Set-Cookie, as a browser sends them back. */
  const cookieHeader = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

  /*
   * A shared cache keeping any of these would hand one visitor's CSRF token,
   * callback URL or session to everyone it served.
   */
  it.each(["/sign-in", "/history", "/api/blocks", "/api/auth/session"])(
    "marks %s no-store when it sets a cookie",
    async (path) => {
      const response = await cookielessGet(path);
      expect(response.headers.getSetCookie()).not.toEqual([]);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("marks a signed-in API answer no-store, since it carries the refreshed session", async () => {
    const token = await encode({
      token: { sub: "u1", role: "member", deactivated: false },
      secret: SECRET,
      salt: SESSION,
    });
    const response = await proxy(
      new NextRequest(`${ORIGIN}/api/blocks`, { headers: { cookie: `${SESSION}=${token}` } }),
      event,
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__Secure-authjs\.session-token=/),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps /sign-in no-store on a return visit, which sets no cookie", async () => {
    const first = await cookielessGet("/sign-in");
    const again = await proxy(
      new NextRequest(`${ORIGIN}/sign-in`, { headers: { cookie: cookieHeader(first) } }),
      event,
    );
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(again.headers.get("cache-control")).toBe("no-store");
  });
});
