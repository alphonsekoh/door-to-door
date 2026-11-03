import type { APIResponse, Page } from "@playwright/test";
import { securityHeaders } from "../src/server/http/security-headers";
import { SEED_ADMIN, SEED_MEMBER, SEED_PASSWORD } from "./accounts";
import { expect, test } from "./fixtures";

/*
 * Flow 1: signing in, and the role split.
 *
 * Driven through the form rather than the saved sessions the other specs use -
 * this is the one place the credentials path itself is exercised end to end.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("signing in", () => {
  test("an admin reaches the app and sees the admin section", async ({ page }) => {
    await signIn(page, SEED_ADMIN);

    await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  });

  test("a member reaches the app without it", async ({ page }) => {
    // Affordance, not authorization - but a member should not be shown a tab
    // whose every request comes back 403.
    await signIn(page, SEED_MEMBER);

    await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin" })).toBeHidden();
  });

  test("a member is refused the admin screens by URL as well as by nav", async ({ memberPage }) => {
    await memberPage.goto("/admin/sessions");
    await expect(memberPage.getByRole("heading", { level: 1, name: "Sessions" })).toBeHidden();
  });

  test("a wrong password is refused, and says so", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEED_ADMIN);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/sign-in/);
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.goto("/history");
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe("response headers", () => {
  /* What the production build sends: the suite runs against it, not next dev. */
  const expected = securityHeaders({ development: false });

  const carriesThemAll = (response: APIResponse) => {
    const headers = response.headers();
    for (const { key, value } of expected) {
      expect(headers[key.toLowerCase()], `${response.url()} ${key}`).toBe(value);
    }
    expect(headers["x-powered-by"], response.url()).toBeUndefined();
  };

  test("every response carries the security headers", async ({ request, adminApi }) => {
    // Pages, the PWA paths the proxy skips, a static file, and the answers
    // the proxy, withContract and Auth.js each write themselves.
    for (const path of ["/sign-in", "/offline", "/serwist/sw.js", "/icon-192.png"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      carriesThemAll(response);
    }

    const signedOut = await request.get("/history", { maxRedirects: 0 });
    expect(signedOut.status()).toBe(307);
    carriesThemAll(signedOut);

    for (const [response, status] of [
      [await request.get("/api/blocks"), 401],
      [await request.get("/api/auth/csrf"), 200],
      [await adminApi.get("/api/blocks"), 200],
    ] as const) {
      expect(response.status(), response.url()).toBe(status);
      expect(response.headers()["cache-control"], response.url()).toBe("no-store");
      carriesThemAll(response);
    }
  });
});
