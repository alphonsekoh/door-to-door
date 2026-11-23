import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Google sign-in (#14), and asking to join with it (#249), against the
 * stand-in config.yaml points the app at (e2e/fake-google.ts): nothing here
 * reaches Google.
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
  // At gmail.com, which Google vouches for with no Workspace domain (hd).
  const email = `google-${browserName}-${String(Date.now())}@gmail.com`;
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

/* #249: anyone Google vouches for may ask to join, and waits for an admin. */
async function askToJoin(page: Page, baseURL: string | undefined, email: string): Promise<void> {
  await page.goto(local("/sign-in", baseURL));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await chooseOnGoogle(page, email);
  await expect(page).toHaveURL(/\/waiting(\?|$)/);
}

/* Drawn whole: nothing cut off by an ellipsis or spilling out of its box. */
async function expectWhole(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await expect
    .poll(() => target.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
}

/* The request's row on Admin > Team, in the section `heading` names. The
   admin's saved sign-in is on the harness's own address, not localhost. */
function requestRow(page: Page, heading: string, email: string) {
  return page
    .getByRole("region", { name: new RegExp(`^${heading}`) })
    .getByRole("listitem")
    .filter({ hasText: email });
}

test("a new address asks to join, waits with no way into the app, and is let in once approved", async ({
  page,
  adminPage,
  baseURL,
  browserName,
}) => {
  const email = `newcomer-${browserName}-${String(Date.now())}@gmail.com`;
  await askToJoin(page, baseURL, email);

  await expect(page.getByRole("heading", { level: 1, name: "Waiting for approval" })).toBeVisible();
  await expect(page.getByText(`An admin needs to approve ${email}`)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  // Google's name, which the person can put right.
  await expect(page.getByLabel("Your name")).toHaveValue("Name From Google");
  await page.getByLabel("Your name").fill("Newcomer Tan");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toHaveText("Name saved.");

  // The policy opens from here, and Back returns, though the account is unapproved.
  await page.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Waiting for approval" })).toBeVisible();

  // Nothing else opens: the app's own screens send them back.
  await page.goto(local("/history", baseURL));
  await expect(page).toHaveURL(/\/waiting$/);
  await expect(page.getByRole("heading", { level: 1, name: "Waiting for approval" })).toBeVisible();

  await adminPage.goto("/admin/sessions");
  await expect(
    adminPage.getByRole("link", { name: /^Admin, \d+ waiting for approval$/ }),
  ).toBeVisible();
  await adminPage.goto("/admin/team");
  const row = requestRow(adminPage, "Waiting for approval", email);
  await expect(row).toContainText("Newcomer Tan");
  await row.getByRole("button", { name: `Approve Newcomer Tan (${email})` }).click();
  await expect(row).toHaveCount(0);

  // No new sign-in: the next request is let through.
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Active session" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("a rejected address is told so, even signing in again, until an admin unblocks it", async ({
  page,
  adminPage,
  baseURL,
  browserName,
}) => {
  // Long, so at the largest text it is wider than the screen.
  const email = `turned-down-with-a-long-address-${browserName}-${String(Date.now())}@gmail.com`;
  await askToJoin(page, baseURL, email);

  await adminPage.goto("/admin/team");
  // The whole address, which ends in the domain that tells requests apart.
  await adminPage.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  const waiting = requestRow(adminPage, "Waiting for approval", email);
  await expectWhole(waiting.getByText(email, { exact: true }));
  await waiting.getByRole("button", { name: `Reject Name From Google (${email})` }).click();
  const question = `Reject Name From Google (${email})?`;
  const confirm = adminPage.getByRole("alertdialog", { name: question });
  await expectWhole(confirm.getByText(question, { exact: true }));
  await adminPage.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await confirm.getByRole("button", { name: "Reject" }).click();
  await expect(requestRow(adminPage, "Not approved", email)).toBeVisible();

  await page.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your request wasn't approved" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await chooseOnGoogle(page, email);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your request wasn't approved" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await expect(page.getByLabel("Your name")).toHaveCount(0);

  await requestRow(adminPage, "Not approved", email)
    .getByRole("button", { name: /^Unblock/ })
    .click();
  await expect(requestRow(adminPage, "Waiting for approval", email)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Waiting for approval" })).toBeVisible();
});

test("a personal Google account on a Workspace domain is turned away with the one message, and no account", async ({
  page,
  adminApi,
  baseURL,
  browserName,
}) => {
  // tjc.sg is on Google Workspace, so a personal account made on it carries no hd.
  const email = `personal-${browserName}-${String(Date.now())}@tjc.sg`;

  await page.goto(local("/sign-in", baseURL));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await chooseOnGoogle(page, email);

  await expect(page).toHaveURL(/\/sign-in\?error=AccessDenied$/);
  await expect(
    page.getByText(
      "That Google account can't sign in here. Google sign-in is for " +
        "gmail.com, tjc.sg or tjc.org accounts; otherwise, use your email and password.",
    ),
  ).toHaveAttribute("role", "alert");
  await expect(page.locator("body")).not.toContainText("AccessDenied");

  for (const approval of ["approved", "pending", "blocked"]) {
    const listed = await adminApi.get(
      `/api/users?limit=100&includeDeactivated=true&approval=${approval}`,
    );
    const { data } = (await listed.json()) as { data: { email: string }[] };
    expect(data.map((user) => user.email)).not.toContain(email);
  }
});
