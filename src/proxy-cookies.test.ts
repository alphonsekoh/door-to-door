import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The real Auth.js wrapper, not a stub: what matters here is the Set-Cookie
 * header it adds, which a stubbed NextAuth cannot show.
 */
vi.mock("@/server/config", () => ({
  getConfig: () => ({
    authSecret: "s".repeat(40),
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
