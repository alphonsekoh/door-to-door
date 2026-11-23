import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "@/lib/config";

/*
 * Under next dev the proxy answers only requests addressed to this machine
 * (#124), before Auth.js or the settings file are touched. Real Auth.js, so a
 * request that gets through is answered exactly as it would be otherwise;
 * whether it read the settings shows whether it got that far.
 */

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

const { default: proxy } = await import("@/proxy");

const event = {} as NextFetchEvent;

/* The URL is the bind address, as next dev builds it; Host is what the browser asked for. */
async function send(
  pathname: string,
  headers: Record<string, string> = { host: "evil.test:3000" },
): Promise<Response> {
  const response = await proxy(
    new NextRequest(`http://127.0.0.1:3000${pathname}`, { headers }),
    event,
  );
  if (!(response instanceof Response)) throw new Error("the proxy gave no response");
  return response;
}

beforeEach(() => {
  getConfig.mockReturnValue({
    ...parseConfig(
      "database:\n  url: postgresql://localhost:5432/door_to_door\n" +
        "privacy:\n  organisation: Example Operator\n  dpoEmail: dpo@example.com\n",
      "config.yaml",
    ),
    authSecret: "k3Jx9Qw2LmZp0Rt7Vb5Nc8Hd1Fg4Ys6A",
  });
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
  getConfig.mockReset();
});

describe("under next dev, a foreign Host", () => {
  it.each(["/history", "/api/blocks", "/api/auth/session", "/manifest.webmanifest", "/sign-in"])(
    "is refused on %s before Auth.js or the settings are reached",
    async (pathname) => {
      const response = await send(pathname);

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({
        error: {
          code: "forbidden",
          message: "This development server answers only on localhost.",
        },
      });
      expect(getConfig).not.toHaveBeenCalled();
    },
  );

  it("is refused when there is no Host at all", async () => {
    expect((await send("/history", {})).status).toBe(403);
  });

  it("is refused even when X-Forwarded-Host claims localhost, which a page can set", async () => {
    const response = await send("/api/blocks", {
      host: "evil.test:3000",
      "x-forwarded-host": "localhost:3000",
    });
    expect(response.status).toBe(403);
  });
});

describe("under next dev, this machine's own names", () => {
  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])(
    "get the usual answer at %s",
    async (host) => {
      const response = await send("/history", { host });

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/sign-in");
      expect(getConfig).toHaveBeenCalled();
    },
  );

  it("still let the PWA files through without Auth.js", async () => {
    const response = await send("/manifest.webmanifest", { host: "localhost:3000" });
    expect(response.status).toBe(200);
    expect(getConfig).not.toHaveBeenCalled();
  });
});

describe("in a production build", () => {
  it("answers a foreign Host as usual: the deployment's own host is not known here", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await send("/history");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });
});
