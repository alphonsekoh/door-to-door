import { describe, expect, it, vi } from "vitest";
import { withAuthRouteHeaders } from "@/server/auth/route-headers";

const ORIGIN = "https://app.example.org";

const call = (
  path: string,
  method: "GET" | "POST",
  respond: () => Response = () => Response.json({ ok: true }),
) => {
  const handler = vi.fn((_request: Request) => Promise.resolve(respond()));
  const request = new Request(`${ORIGIN}${path}`, { method });
  return { handler, response: withAuthRouteHeaders(handler)(request), request };
};

describe("Auth.js's routes", () => {
  it.each([
    ["/api/auth/csrf", "GET"],
    ["/api/auth/session", "GET"],
    ["/api/auth/callback/credentials", "POST"],
    ["/api/auth/signout", "POST"],
  ] as const)(
    "answer %s (%s) no-store, since they carry the CSRF token and session",
    async (path, method) => {
      const { response } = call(path, method);
      expect((await response).headers.get("cache-control")).toBe("no-store");
    },
  );

  it("override whatever caching Auth.js chose", async () => {
    const { response } = call("/api/auth/session", "GET", () =>
      Response.json({}, { headers: { "cache-control": "private, max-age=60" } }),
    );
    expect((await response).headers.get("cache-control")).toBe("no-store");
  });

  it("hand the handler the request as it came", async () => {
    const { handler, response, request } = call("/api/auth/csrf", "GET");
    await response;
    expect(handler).toHaveBeenCalledWith(request);
  });
});

describe("signing out", () => {
  it('clears the HTTP cache, and only that: never "storage", which holds the queue', async () => {
    const { response } = call("/api/auth/signout", "POST");
    expect((await response).headers.get("clear-site-data")).toBe('"cache"');
  });

  it("clears it on a refused sign-out too, where Auth.js redirects to its error page", async () => {
    const { response } = call("/api/auth/signout", "POST", () =>
      Response.redirect(`${ORIGIN}/sign-in?error=MissingCSRF`, 302),
    );
    expect((await response).headers.get("clear-site-data")).toBe('"cache"');
  });

  it.each([
    ["/api/auth/signout", "GET"],
    ["/api/auth/callback/credentials", "POST"],
    ["/api/auth/signout/extra", "POST"],
  ] as const)("is the only answer that clears anything: not %s (%s)", async (path, method) => {
    const { response } = call(path, method);
    expect((await response).headers.has("clear-site-data")).toBe(false);
  });
});

describe("the copied response", () => {
  it("keeps the status, its text and the body", async () => {
    const { response } = call("/api/auth/callback/credentials", "POST", () =>
      Response.json({ url: "/" }, { status: 401, statusText: "Unauthorized" }),
    );
    const copy = await response;
    expect(copy.status).toBe(401);
    expect(copy.statusText).toBe("Unauthorized");
    expect(copy.headers.get("content-type")).toBe("application/json");
    expect(await copy.json()).toEqual({ url: "/" });
  });

  it("keeps every Set-Cookie as its own header, so sign-in still sets both", async () => {
    const cookies = [
      "__Secure-authjs.session-token=jwt; Path=/; Secure; HttpOnly",
      "__Secure-authjs.callback-url=%2F; Path=/; Secure; HttpOnly",
    ];
    const { response } = call("/api/auth/callback/credentials", "POST", () => {
      const headers = new Headers({ location: `${ORIGIN}/` });
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      return new Response(null, { status: 302, headers });
    });
    expect((await response).headers.getSetCookie()).toEqual(cookies);
  });

  it("can add headers to a redirect, whose own headers are immutable", async () => {
    const redirect = Response.redirect(`${ORIGIN}/sign-in`, 302);
    expect(() => {
      redirect.headers.set("cache-control", "no-store");
    }).toThrow(TypeError);

    const { response } = call("/api/auth/signout", "POST", () =>
      Response.redirect(`${ORIGIN}/sign-in`, 302),
    );
    const copy = await response;
    expect(copy.status).toBe(302);
    expect(copy.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
    expect(copy.headers.get("cache-control")).toBe("no-store");
  });
});
