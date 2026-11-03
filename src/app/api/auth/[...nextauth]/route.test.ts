import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { GET, POST } from "./route";

/*
 * Real Auth.js underneath, with only the config file stood in for: a rename
 * in Auth.js, or an export that skips the header wrapper, fails here rather
 * than at runtime. Neither request below reaches the database.
 */
vi.mock("@/server/config", () => ({
  getConfig: () => ({
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/nowhere",
    authSecret: "a-secret-that-is-long-enough-for-tests",
    auth: { trustHost: true, secureCookies: true },
    rateLimit: {
      signInAttempts: 10,
      signInAttemptsPerClient: 30,
      signInWindowSeconds: 300,
      trustedProxyHops: 0,
    },
  }),
}));

afterEach(async () => {
  await resetDatabase();
});

const ORIGIN = "http://127.0.0.1:3210";

describe("auth catch-all route", () => {
  it("answers GET with Auth.js's CSRF token, no-store", async () => {
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ csrfToken: expect.any(String) as string });
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Secure under the default config, though this request is plain http.
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContainEqual(expect.stringMatching(/^__Host-authjs\.csrf-token=/));
    expect(cookies.filter((cookie) => !/; Secure(;|$)/.test(cookie))).toEqual([]);
  });

  it("clears the HTTP cache on a sign-out POST, even one Auth.js refuses", async () => {
    // No CSRF token, so Auth.js refuses it: clearing the cache costs nothing.
    const response = await POST(new NextRequest(`${ORIGIN}/api/auth/signout`, { method: "POST" }));
    expect(response.headers.get("clear-site-data")).toBe('"cache"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
