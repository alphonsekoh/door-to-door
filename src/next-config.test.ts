import { describe, expect, it, vi } from "vitest";
import { securityHeaders } from "@/server/http/security-headers";

/* The worker plugin only adds its own build steps; what is under test is ours. */
vi.mock("@serwist/turbopack", () => ({ withSerwist: <T>(config: T) => config }));

const { default: nextConfig } = await import("../next.config");

async function rules() {
  if (nextConfig.headers === undefined) throw new Error("next.config sets no headers()");
  return nextConfig.headers();
}

describe("next.config", () => {
  it("does not announce the framework in X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the security headers on every path, built for production outside next dev", async () => {
    const all = (await rules()).find((rule) => rule.source === "/(.*)");
    expect(all?.headers).toEqual(securityHeaders({ development: false }));
  });

  it("still keeps the worker script out of every cache", async () => {
    const worker = (await rules()).find((rule) => rule.source === "/serwist/:path*");
    expect(worker?.headers).toEqual([
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    ]);
  });
});
