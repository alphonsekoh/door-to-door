import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Google sign-in (#14), against the stand-in config.yaml points the app at
 * (e2e/fake-google.ts): nothing here reaches Google.
 *
 * On localhost rather than 127.0.0.1. Next names 127.0.0.1 localhost in the
 * request Auth.js reads, so the address Google is told to come back to is on
 * localhost, and the cookies set on the way out must be there when it does.
 * A deployment has one name for itself, so this is the harness's alone.
 */

function local(path: string, baseURL: string | undefined): string {
  const url = new URL(path, baseURL);
  url.hostname = "localhost";
  return url.toString();
}

/* Google's page, as the stand-in draws it: the account chooser every time. */
async function chooseOnGoogle(page: Page, email: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Choose an account" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("someone an admin added with no password signs in with Google", async ({
  page,
  adminApi,
  baseURL,
  browserName,
}) => {
  const email = `google-${browserName}-${String(Date.now())}@example.com`;
  const added = await adminApi.post("/api/users", { data: { email, name: "Google Member" } });
  expect(added.status()).toBe(201);

  await page.goto(local("/sign-in", baseURL));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await chooseOnGoogle(page, email);

  await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();
  await page.goto(local("/account", baseURL));
  // The name the admin gave, not Google's.
  await expect(page.getByLabel("Your name")).toHaveValue("Google Member");
});

test("an address nobody added is turned away with the one message, and no account", async ({
  page,
  adminApi,
  baseURL,
  browserName,
}) => {
  const email = `stranger-${browserName}-${String(Date.now())}@example.com`;

  await page.goto(local("/sign-in", baseURL));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await chooseOnGoogle(page, email);

  await expect(page).toHaveURL(/\/sign-in\?error=AccessDenied$/);
  await expect(
    page.getByText(
      "That Google account can't sign in here. Use the email address your admin added.",
    ),
  ).toHaveAttribute("role", "alert");
  await expect(page.locator("body")).not.toContainText("AccessDenied");

  const team = await adminApi.get("/api/users?limit=100&includeDeactivated=true");
  const { data } = (await team.json()) as { data: { email: string }[] };
  expect(data.map((user) => user.email)).not.toContain(email);
});
