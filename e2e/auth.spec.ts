import type { APIRequestContext, Page } from "@playwright/test";
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

test.describe("the request body cap (#120)", () => {
  /*
   * Next truncates a body the proxy sees past experimental.proxyClientMaxBodySize
   * rather than refusing it, so the cap shows as fields beyond it never being
   * read. Only the production build can show it: jsdom has no Next server.
   */
  async function signsInBehind(request: APIRequestContext, padding: number): Promise<boolean> {
    const csrf = (await (await request.get("/api/auth/csrf")).json()) as { csrfToken: string };
    const body = new URLSearchParams({
      pad: "x".repeat(padding),
      csrfToken: csrf.csrfToken,
      email: SEED_MEMBER,
      password: SEED_PASSWORD,
      callbackUrl: "/",
    });
    const response = await request.post("/api/auth/callback/credentials", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: body.toString(),
      maxRedirects: 0,
    });
    return response
      .headersArray()
      .some(
        ({ name, value }) =>
          name.toLowerCase() === "set-cookie" && value.includes("session-token="),
      );
  }

  test("signs in with the credentials behind a kilobyte of padding", async ({ request }) => {
    expect(await signsInBehind(request, 1024)).toBe(true);
  });

  test("never reads credentials that sit past the first 2 MB", async ({ request }) => {
    expect(await signsInBehind(request, 2.5 * 1024 * 1024)).toBe(false);
  });
});
