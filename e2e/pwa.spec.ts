import type { Page } from "@playwright/test";
import { SEED_BLOCK, SEED_MEMBER, SEED_PARTNER, SEED_PASSWORD } from "./accounts";
import { endActiveSession, ensureActiveSession, expect, test } from "./fixtures";

/*
 * The PWA layer in a real browser. jsdom cannot register a service worker, so
 * this is the only place the worker, the manifest and the offline fallback are
 * seen working together.
 */

test.use({ serviceWorkers: "allow" });

/* Whose local copy is on the phone, or null when there is none. */
function savedCopyMember(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open("door-to-door-local");
        open.onupgradeneeded = () => {
          open.result.createObjectStore("copy");
        };
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("copy").objectStore("copy").get("current");
          get.onsuccess = () => {
            const copy = get.result as { member?: { name?: string } } | undefined;
            db.close();
            resolve(copy?.member?.name ?? null);
          };
        };
      }),
  );
}

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
    expect(html).toContain("Offline");
    // The same file is served to whoever holds the phone (D-32-4, D-77-7).
    expect(html).not.toContain("Alice");
    expect(html).not.toContain("Blk 123");
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
    await expect(memberPage.getByRole("heading", { level: 1, name: "Offline" })).toBeVisible();
    // Nothing opened yet to record with, so the shell says so.
    await expect(memberPage.getByText(/Nothing is saved on this phone/)).toBeVisible();

    await memberPage.context().setOffline(false);
    await memberPage.getByRole("button", { name: "Try again" }).click();
    await expect(
      memberPage.getByRole("heading", { level: 1, name: "Active session" }),
    ).toBeVisible();
  });

  /* #77. Chromium only, for the same reason as the fallback test above. */
  test("a cold offline reload records, and sends when signal returns, with no reload", async ({
    memberPage: page,
    adminApi,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Playwright WebKit offline emulation bypasses the worker");
    const sessionId = await ensureActiveSession(adminApi);
    const unit = `#3${String(Date.now() % 10)}-${String(Date.now() % 97).padStart(2, "0")}`;

    await page.goto("/");
    await page.getByRole("link", { name: /Blk 123/ }).click();
    await expect(page.getByRole("button", { name: "Save and next" })).toBeVisible();
    await controlled(page);
    // The block page wrote it into the local copy once its units loaded.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string[]>((resolve) => {
              const open = indexedDB.open("door-to-door-local");
              open.onsuccess = () => {
                const db = open.result;
                const get = db.transaction("copy").objectStore("copy").get("current");
                get.onsuccess = () => {
                  const copy = get.result as { blocks?: { block: { id: string } }[] } | undefined;
                  db.close();
                  resolve((copy?.blocks ?? []).map((b) => b.block.id));
                };
              };
            }),
        ),
      )
      .toContain(SEED_BLOCK);

    await page.context().setOffline(true);
    await page.reload().catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Offline" })).toBeVisible();
    // Nobody records, and no queue runs, until the phone is told who is holding it.
    await expect(page.getByRole("button", { name: "Save and next" })).toBeHidden();
    await page.getByRole("button", { name: /^Continue as Alice/ }).click();

    await page.getByRole("button", { name: /Blk 123/ }).click();
    await page.getByLabel("Unit number").fill(unit);
    await page.getByRole("radio", { name: "High" }).click();
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(page.getByText(`Saved ${unit} on this phone.`)).toBeVisible();
    await expect(page.getByRole("button", { name: /1 waiting to send/ })).toBeVisible();
    await expect(page.getByText("1 record is saved on this phone.")).toBeVisible();

    const saved = await page.evaluate(
      (target) =>
        new Promise<{ ownerId: string; sessionId: string } | undefined>((resolve) => {
          const open = indexedDB.open("door-to-door");
          open.onsuccess = () => {
            const db = open.result;
            const all = db.transaction("visits").objectStore("visits").getAll();
            all.onsuccess = () => {
              const rows = all.result as {
                ownerId: string;
                item: { unitNumber: string; sessionId: string };
              }[];
              const row = rows.find((r) => r.item.unitNumber === target);
              db.close();
              resolve(row && { ownerId: row.ownerId, sessionId: row.item.sessionId });
            };
          };
        }),
      unit,
    );
    expect(saved).toEqual({ ownerId: "00000000-0000-4000-8000-000000000002", sessionId });

    // A pull while offline would be a cold reload; neither scroller lets it start.
    const overscroll = await page.evaluate(() => [
      getComputedStyle(document.documentElement).overscrollBehaviorY,
      getComputedStyle(document.body).overscrollBehaviorY,
    ]);
    expect(overscroll).toEqual(["none", "none"]);
    // The Save bar sits on the bottom edge, with no nav to clear.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();

    await page.evaluate(() => {
      Reflect.set(window, "__stillHere", true);
    });
    await page.context().setOffline(false);
    // A document loaded offline keeps navigator.onLine true in Playwright, so
    // setOffline(false) fires no `online` there; a phone does. Without this the
    // queue's own retry timer sends, and neither the wake nor the no-reload is
    // tested.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("All visits sent")).toBeVisible();
    // No reload happened: the page's own state survived.
    expect(await page.evaluate(() => Reflect.get(window, "__stillHere") === true)).toBe(true);
    // Sent, and still listed: the shell cannot re-read the server's units.
    await page.getByRole("tab", { name: /Units/ }).click();
    await expect(page.getByText(unit)).toBeVisible();
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Blk / })).toBeVisible();
    await page.getByRole("tab", { name: /Units/ }).click();
    await expect(page.getByText(unit)).toBeVisible();
  });

  test("the next member to sign in on the phone sees nothing of the last one's", async ({
    memberPage: page,
    adminApi,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Playwright WebKit offline emulation bypasses the worker");
    await ensureActiveSession(adminApi);
    await page.goto("/");
    await page.getByRole("link", { name: /Blk 123/ }).click();
    await expect(page.getByRole("button", { name: "Save and next" })).toBeVisible();
    // Something of Alice's in the queue, which must outlive the clear.
    await page.getByLabel("Unit number").fill("#38-01");
    await page.getByRole("radio", { name: "Low" }).click();
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(page.getByText(/^Saved #38-01/)).toBeVisible();

    await expect.poll(() => savedCopyMember(page)).not.toBeNull();

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/sign-in/);
    /* Not to the outing screen: that writes Ben's own copy over Alice's,
       which would pass this test even if nothing ever cleared hers. */
    await page.goto("/sign-in?callbackUrl=%2Faccount");
    await page.getByLabel("Email").fill(SEED_PARTNER);
    await page.getByLabel("Password").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await controlled(page);
    await expect.poll(() => savedCopyMember(page)).toBeNull();

    const queued = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open("door-to-door");
          open.onsuccess = () => {
            const db = open.result;
            const all = db.transaction("visits").objectStore("visits").getAll();
            all.onsuccess = () => {
              const rows = all.result as { item: { unitNumber: string } }[];
              db.close();
              resolve(rows.map((r) => r.item.unitNumber));
            };
          };
        }),
    );
    expect(queued).toContain("#38-01");

    await page.context().setOffline(true);
    await page.reload().catch(() => undefined);
    await expect(page.getByText(/Nothing is saved on this phone/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Alice");
    await expect(page.locator("body")).not.toContainText("Blk 123");
    await page.context().setOffline(false);
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

  /* iOS WebKit ignores min-height on a native select and drew the admin
     filters 26px tall, under the 44px rule (D-30-8); selects carry h-12. */
  test("admin filter selects are at least 44px tall", async ({ adminPage, adminApi }) => {
    await ensureActiveSession(adminApi);
    for (const [path, label] of [
      ["/admin/records", "Filter by block"],
      ["/admin/history?sessionId=00000000-0000-4000-8002-000000000001", "Filter by block"],
    ] as const) {
      await adminPage.goto(path);
      await expect(adminPage.getByLabel(label)).toBeVisible();
      const selects = await adminPage.locator("main select").all();
      expect(selects.length, `${path} has its filters`).toBeGreaterThan(2);
      for (const select of selects) {
        const id = await select.getAttribute("id");
        await expect
          .poll(async () => (await select.boundingBox())?.height ?? 0, {
            message: `${path} #${String(id)}`,
          })
          .toBeGreaterThanOrEqual(44);
      }
    }
    await endActiveSession(adminApi);
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

      /* Scrolled and measured together, and polled: the page keeps growing
         after the heading shows (the list loads, the reservation is applied),
         and a scroll issued before that stops short of the real bottom. That
         was the whole of the WebKit flake - the reservation was always right.
         A banner that really covers the last item stays negative until the
         timeout, so this cannot pass a genuine overlap. */
      await expect
        .poll(
          () =>
            memberPage.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
              const last = document.querySelector("main")?.lastElementChild;
              const banner = document.querySelector('aside[aria-label="Install the app"]');
              return banner && last
                ? banner.getBoundingClientRect().top - last.getBoundingClientRect().bottom
                : null;
            }),
          { message: `${path}: the banner covers the last item` },
        )
        .toBeGreaterThanOrEqual(0);

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
