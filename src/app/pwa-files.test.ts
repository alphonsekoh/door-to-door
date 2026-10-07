import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

const PUBLIC = join(process.cwd(), "public");

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(PUBLIC, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the web app manifest", () => {
  const m = manifest();

  it("is installable as a standalone portrait app", () => {
    expect(m).toMatchObject({
      id: "/",
      name: "Door to Door",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
    });
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();
  });

  it("offers 192 and 512 icons for any use and a 512 maskable one", () => {
    const icons = m.icons ?? [];
    const has = (sizes: string, purpose: string) =>
      icons.some((icon) => icon.sizes === sizes && icon.purpose === purpose);
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });

  it("points every icon at a file that exists, at the size it claims", () => {
    for (const icon of m.icons ?? []) {
      const file = icon.src.replace(/^\//, "");
      expect(existsSync(join(PUBLIC, file)), `${icon.src} is missing`).toBe(true);
      const [width] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(file)).toEqual({ width, height: width });
    }
  });
});

describe("icons", () => {
  it("ships the iOS home screen icon at 180px, and the SVG it is made from", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(statSync(join(PUBLIC, "icon.svg")).size).toBeGreaterThan(0);
  });
});

describe("the service worker route", () => {
  it("builds /serwist/sw.js from the worker source and precaches /offline", async () => {
    const createSerwistRoute = vi.fn(() => ({ GET: "route" }));
    vi.resetModules();
    vi.doMock("@serwist/turbopack", () => ({ createSerwistRoute }));

    await import("@/app/serwist/[path]/route");

    const [options] = createSerwistRoute.mock.calls[0] as unknown as [
      { swSrc: string; additionalPrecacheEntries: { url: string }[]; globPatterns: string[] },
    ];
    expect(options.swSrc).toBe("src/app/sw.ts");
    expect(options.additionalPrecacheEntries.map((entry) => entry.url)).toContain("/offline");
    // Never precache signed-in HTML: only static build output and icons.
    expect(options.globPatterns.join()).not.toMatch(/\.html|server\/app/);
    vi.doUnmock("@serwist/turbopack");
  });
});
