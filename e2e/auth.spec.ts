import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/sign-in/);
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.goto("/history");
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe("signing in before the page is live (#125)", () => {
  /* page.route misses requests the service worker makes in WebKit. */
  test.use({ serviceWorkers: "block" });

  /*
   * Weak signal: the page is drawn well before its scripts arrive. The email
   * form was once in that HTML as a plain GET form, so Go sent the password
   * to the address bar, and what was typed was emptied at the first tap
   * once the page was live.
   */
  test("offers Google at once, and the email form only once it can send it", async ({ page }) => {
    const loaded: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) loaded.push(request.url());
    });
    let arrive: () => void = () => undefined;
    const scripts = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await page.route(/\/_next\/static\/chunks\/[^?]*\.js(\?|$)/, async (route) => {
      await scripts;
      await route.continue();
    });
    await page.goto("/sign-in", { waitUntil: "commit" });

    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByLabel("Password")).toHaveCount(0);

    arrive();
    await page.getByLabel("Email").fill(SEED_MEMBER);
    await page.getByLabel("Password").fill(SEED_PASSWORD);
    await page.getByLabel("Password").press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();
    expect(loaded.filter((url) => url.includes("password"))).toEqual([]);
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

  test("/sign-in is no-store, whether or not it sets a cookie (#150)", async ({ request }) => {
    // A shared cache must never keep it, with Auth.js's CSRF cookie or without.
    const setCookies = (response: APIResponse) =>
      response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie");

    const first = await request.get("/sign-in");
    expect(setCookies(first)).not.toEqual([]);
    expect(first.headers()["cache-control"]).toBe("no-store");

    // Its cookies go back now, so nothing is set, and still no shared cache may keep it.
    const again = await request.get("/sign-in");
    expect(setCookies(again)).toEqual([]);
    expect(again.headers()["cache-control"]).toBe("no-store");
  });
});

test.describe("the request body cap (#120, #126)", () => {
  /*
   * Next truncates a body the proxy sees past experimental.proxyClientMaxBodySize
   * rather than refusing it, so on Auth.js's routes the cap shows as fields
   * beyond it never being read. Only the production build can show it: jsdom
   * has no Next server.
   *
   * The CSRF token goes ahead of the padding, so a cut body still passes Auth.js's
   * CSRF check and reaches authorize without the credentials; behind it, the
   * refusal would be MissingCSRF and prove nothing about the credentials.
   */
  async function signInBehind(request: APIRequestContext, padding: number) {
    const csrf = (await (await request.get("/api/auth/csrf")).json()) as { csrfToken: string };
    const body = new URLSearchParams({
      csrfToken: csrf.csrfToken,
      pad: "x".repeat(padding),
      email: SEED_MEMBER,
      password: SEED_PASSWORD,
      callbackUrl: "/",
    });
    const response = await request.post("/api/auth/callback/credentials", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: body.toString(),
      maxRedirects: 0,
    });
    const signedIn = response
      .headersArray()
      .some(
        ({ name, value }) =>
          name.toLowerCase() === "set-cookie" && value.includes("session-token="),
      );
    const error = new URL(
      response.headers()["location"] ?? "/",
      "http://localhost",
    ).searchParams.get("error");
    return { signedIn, error };
  }

  test("signs in with the credentials behind a kilobyte of padding", async ({ request }) => {
    expect(await signInBehind(request, 1024)).toEqual({ signedIn: true, error: null });
  });

  test("never reads credentials that sit past the first 2 MB", async ({ request }) => {
    expect(await signInBehind(request, 2.5 * 1024 * 1024)).toEqual({
      signedIn: false,
      error: "CredentialsSignin",
    });
  });

  test("refuses a sync batch the proxy cuts with 413, not as cut-off JSON", async ({
    adminApi,
  }) => {
    // The contract's cap sits below the proxy's, so what the proxy cut is still
    // over it. Signed in: without a session the proxy answers 401 first.
    const response = await adminApi.post("/api/visits/sync", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({
        sentAt: new Date().toISOString(),
        items: [],
        pad: "x".repeat(2.5 * 1024 * 1024),
      }),
    });
    expect(response.status()).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "content_too_large",
    );
  });
});
