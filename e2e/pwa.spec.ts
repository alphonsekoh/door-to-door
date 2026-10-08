import type { Page } from "@playwright/test";
import { SEED_MEMBER, SEED_PASSWORD } from "./accounts";
import { endActiveSession, ensureActiveSession, expect, test } from "./fixtures";

/*
 * The PWA layer in a real browser. jsdom cannot register a service worker, so
 * this is the only place the worker, the manifest and the offline fallback are
 * seen working together.
 */

test.use({ serviceWorkers: "allow" });

/* Waits for the worker to be in charge of this page. clientsClaim is off by
   design, so a page is controlled from its second load, not its first. */
async function controlled(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test.describe("installability, signed out", () => {
  test("the manifest is served without a session and is installable", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("json");

    const manifest = (await response.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ name: "Door to Door", display: "standalone", start_url: "/" });
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);

    for (const icon of manifest.icons) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"]).toContain("image/png");
    }
  });

  test("the page declares what a phone needs to render it properly", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /width=device-width/,
    );
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveCount(1);
  });

  test("the worker script is public, JavaScript, and never cached", async ({ request }) => {
    const response = await request.get("/serwist/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toContain("no-cache");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).toContain("/offline");
  });

  test("guarded endpoints stay guarded", async ({ request }) => {
    const response = await request.get("/api/sessions/active", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  });
});

test.describe("the worker in charge", () => {
  test("activates, and takes control of the next load", async ({ memberPage }) => {
    await memberPage.goto("/");
    await controlled(memberPage);
    const state = await memberPage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state;
    });
    expect(state).toBe("activated");
  });

  test("the offline page is precached, ready for a dead spot", async ({ memberPage }) => {
    await memberPage.goto("/");
    await controlled(memberPage);

    const html = await memberPage.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname === "/offline") {
            return (await cache.match(request))?.text();
          }
        }
      }
      return undefined;
    });
    expect(html).toContain("offline");
  });

  test("a failed navigation shows the offline page, and recovers on retry", async ({
    memberPage,
    browserName,
  }) => {
    // Playwright's WebKit blocks every request at the network layer once
    // "offline", before the worker can answer - even for a precached URL - so
    // the fallback cannot be exercised there. The precache test above covers
    // what WebKit can; the rest is a manual check on a real iPhone.
    test.skip(browserName === "webkit", "Playwright WebKit offline emulation bypasses the worker");
    await memberPage.goto("/");
    await controlled(memberPage);

    await memberPage.context().setOffline(true);
    await memberPage.goto("/history").catch(() => undefined);
    await expect(memberPage.getByRole("heading", { name: "You're offline" })).toBeVisible();

    await memberPage.context().setOffline(false);
    await memberPage.getByRole("button", { name: "Try again" }).click();
    await expect(
      memberPage.getByRole("heading", { level: 1, name: "Active session" }),
    ).toBeVisible();
  });

  test("an ended outing is not shown stale after a reload", async ({ memberPage, adminApi }) => {
    await ensureActiveSession(adminApi);
    await memberPage.goto("/");
    await controlled(memberPage);
    await expect(memberPage.getByRole("link", { name: /Blk 123/ })).toBeVisible();

    await endActiveSession(adminApi);
    await memberPage.reload();

    await expect(memberPage.getByRole("link", { name: /Blk 123/ })).toBeHidden();
    // And the live-state endpoints were never put in the cache to begin with.
    const cached = await memberPage.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      }
      return urls;
    });
    expect(
      cached.filter((url) => /\/api\/(sessions|follow-ups|history|households|visits)/.test(url)),
    ).toEqual([]);
    expect(cached.filter((url) => url.includes("/api/auth"))).toEqual([]);
  });

  test("the block list is cached, and forgotten on request", async ({ memberPage }) => {
    await memberPage.goto("/");
    await controlled(memberPage);

    await memberPage.evaluate(() => fetch("/api/blocks").then((r) => r.json()));
    await expect
      .poll(() =>
        memberPage.evaluate(
          async () => (await (await caches.open("api-reference-v1")).keys()).length,
        ),
      )
      .toBeGreaterThan(0);

    await memberPage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "CLEAR_CACHES" });
    });
    await expect.poll(() => memberPage.evaluate(() => caches.has("api-reference-v1"))).toBe(false);
  });
});

test.describe("signing in and out with the worker active", () => {
  test("both still work, and no credentials land in a cache", async ({ page }) => {
    await page.goto("/sign-in");
    await controlled(page);

    await page.getByLabel("Email").fill(SEED_MEMBER);
    await page.getByLabel("Password").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();

    // The real button, and state rather than timing: the redirect to /sign-in
    // only comes after the session cookie is gone.
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/sign-in/);
    await page.goto("/history");
    await expect(page).toHaveURL(/sign-in/);

    const cachedAuth = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      }
      return urls.filter((url) => url.includes("/api/auth"));
    });
    expect(cachedAuth).toEqual([]);
  });
});

test.describe("phone layout", () => {
  test("no horizontal scroll on the main screens", async ({ memberPage }) => {
    for (const path of ["/", "/history", "/follow-ups", "/account"]) {
      await memberPage.goto(path);
      await expect(memberPage.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await memberPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });

  test("nav tap targets are at least 44px", async ({ memberPage }) => {
    await memberPage.goto("/");
    const links = memberPage.getByRole("navigation", { name: "Primary" }).getByRole("link");
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("the install banner", () => {
  /* Chromium fires this itself when the app is installable; a fake keeps the
     check deterministic, and WebKit shows its manual banner regardless. */
  async function offerInstall(page: Page): Promise<void> {
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: () => Promise.resolve(),
        userChoice: new Promise(() => undefined),
      });
      window.dispatchEvent(event);
    });
  }

  test("never covers the last item, and stays off the recording screen", async ({
    memberPage,
    adminApi,
  }) => {
    for (const path of ["/history", "/account"]) {
      await memberPage.goto(path);
      await expect(memberPage.getByRole("heading", { level: 1 })).toBeVisible();
      await offerInstall(memberPage);
      const banner = memberPage.getByRole("complementary", { name: "Install the app" });
      await expect(banner).toBeVisible();

      await memberPage.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      const clearance = await memberPage.evaluate(() => {
        const last = document.querySelector("main")?.lastElementChild;
        const banner = document.querySelector('aside[aria-label="Install the app"]');
        return banner && last
          ? banner.getBoundingClientRect().top - last.getBoundingClientRect().bottom
          : null;
      });
      expect(clearance, `${path}: the banner covers the last item`).toBeGreaterThanOrEqual(0);

      // The seeded pages are short, so also check the room itself: the
      // content's bottom padding must clear the nav and the whole banner.
      const room = await memberPage.evaluate(() => {
        const main = document.querySelector("main");
        const banner = document.querySelector('aside[aria-label="Install the app"]');
        const nav = document.querySelector("nav[aria-label=Primary]");
        return main && banner && nav
          ? parseFloat(getComputedStyle(main).paddingBottom) -
              (banner.getBoundingClientRect().height + nav.getBoundingClientRect().height)
          : null;
      });
      expect(room, `${path}: no room reserved for the banner`).toBeGreaterThanOrEqual(0);
    }

    await ensureActiveSession(adminApi);
    await memberPage.goto("/");
    await memberPage.getByRole("link", { name: /Blk 123/ }).click();
    await expect(memberPage.getByRole("button", { name: "Save and next" })).toBeVisible();
    await offerInstall(memberPage);
    await expect(memberPage.getByRole("complementary", { name: "Install the app" })).toBeHidden();
    await endActiveSession(adminApi);
  });
});
