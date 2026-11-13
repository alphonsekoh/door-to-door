import { MEMBER_STATE, SEED_MEMBER } from "./accounts";
import { expect, test } from "./fixtures";

/*
 * A member renames themselves. Reloading is the point: the name has to come
 * back from the server, not from what the form was still holding.
 */
test.describe("renaming", () => {
  let original = "";

  test.afterEach(async ({ playwright, baseURL }) => {
    // Through the API, so a failed assertion cannot leave the renamed member
    // behind for the specs that follow.
    if (original === "") return;
    const api = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      storageState: MEMBER_STATE,
    });
    await api.patch("/api/users/me", { data: { name: original } });
    await api.dispose();
  });

  test("a new name is still there after a reload", async ({ memberPage }) => {
    await memberPage.goto("/account");
    const input = memberPage.getByLabel("Your name");
    await expect(input).not.toHaveValue("");
    original = await input.inputValue();

    await input.fill("Alice E2E");
    await memberPage.getByRole("button", { name: "Save name" }).click();
    await expect(memberPage.getByRole("status")).toHaveText("Name saved.");

    await memberPage.reload();
    await expect(memberPage.getByLabel("Your name")).toHaveValue("Alice E2E");
  });
});

/*
 * Back after signing out, on a phone someone else picks up next (#129). The
 * sign-out replaces its page in history, so Back goes to the screen before
 * Account. That one is no-store, and a page the browser restores from its
 * back/forward cache anyway is loaded again, so either way the proxy sends
 * it to sign-in with itself as the callback. Had the sign-out pushed a new
 * entry, Back would land on Account and name that instead.
 *
 * Over plain http here; the same on a real iPhone over HTTPS is the owner's
 * check.
 */
/* Each on a sign-in of its own: signing out ends only that one (#125). */
test.describe("signing out", () => {
  test("Back from sign-in does not return a member to the app", async ({
    ownMemberPage: page,
    baseURL,
  }) => {
    await page.goto("/history");
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Account" })
      .click();
    await expect(page.getByLabel("Your name")).not.toHaveValue("");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    // A relative redirect: the origin the member was on is the one they stay on.
    expect(new URL(page.url()).origin).toBe(baseURL);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();

    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fhistory$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeHidden();
  });

  test("Back from sign-in does not show an admin screen's members again", async ({
    ownAdminPage: page,
  }) => {
    await page.goto("/admin/team");
    await expect(page.getByText(SEED_MEMBER).first()).toBeVisible();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Account" })
      .click();
    await expect(page.getByLabel("Your name")).not.toHaveValue("");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fadmin%2Fteam$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText(SEED_MEMBER)).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  });
});

/*
 * A sign-out the server refused, as one that could not end its sign-in does
 * (D-125-20): the phone stays signed in, and Account says so just above Sign
 * out. That alert is drawn at the end of a page with little room left above
 * the nav, and on an iPhone 13 it pushed Sign out under it (#164). At the
 * largest text it did so on both phones, out of sight below the screen.
 */
test.describe("a refused sign-out", () => {
  // Routing sees what a service worker fetches for the page on some engines only.
  test.use({ serviceWorkers: "block" });

  test("leaves its alert and Sign out in view, above the bottom nav", async ({
    ownMemberPage: page,
  }) => {
    await page.route("**/api/auth/signout", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ url: "/sign-in?error=SignOutError" }),
      }),
    );
    const nav = page.getByRole("navigation", { name: "Primary" });

    /* As the phone opens it, then at the largest text (D-111-24), where the
       page is taller than the screen: a full load starts again at the default. */
    for (const size of [null, "32px"]) {
      const at = size ?? "the default text size";
      await page.goto("/account");
      await expect(page.getByLabel("Your name")).not.toHaveValue("");
      if (size !== null) {
        await page.evaluate((root) => {
          document.documentElement.style.fontSize = root;
        }, size);
      }

      await page.getByRole("button", { name: "Sign out" }).click();
      // In the page: Next's route announcer is an alert too.
      const alert = page.getByRole("main").getByRole("alert");
      await expect(alert).toHaveText("Could not sign out. Check your connection and try again.");
      const signOut = page.getByRole("button", { name: "Sign out" });
      await expect(signOut).toBeEnabled();
      await expect(page).toHaveURL(/\/account$/);

      const [alertBox, signOutBox, navBox] = await Promise.all([
        alert.boundingBox(),
        signOut.boundingBox(),
        nav.boundingBox(),
      ]);
      if (alertBox === null || signOutBox === null || navBox === null) {
        throw new Error(`the alert, Sign out or the nav is not drawn at ${at}`);
      }
      expect(alertBox.y, `the alert above the top of the screen at ${at}`).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        signOutBox.y + signOutBox.height,
        `Sign out under the nav at ${at}`,
      ).toBeLessThanOrEqual(navBox.y + 0.5);
      // Told, not moved to: focus stays off the alert.
      await expect(alert).not.toBeFocused();
    }
  });
});

/*
 * Every answer to a signed-in request sets the session cookie again. One to
 * a request sent just before the sign-out and arriving just after it, such
 * as the queue's session check on weak signal, put the cookie back: the
 * member saw sign-in, and the next person to open History was them.
 */
test.describe("signing out with a request still out", () => {
  // Routing sees what a service worker fetches for the page on some engines only.
  test.use({ serviceWorkers: "block" });

  test("its answer landing after the sign-out does not sign the member back in", async ({
    ownMemberPage: page,
  }) => {
    await page.goto("/account");
    await expect(page.getByLabel("Your name")).not.toHaveValue("");

    let signedOut: () => void = () => undefined;
    const signOutAnswered = new Promise<void>((resolve) => {
      signedOut = resolve;
    });
    await page.route("**/api/auth/signout", async (route) => {
      await route.fulfill({ response: await route.fetch() });
      signedOut();
    });
    let asked = false;
    await page.route("**/api/auth/session", async (route) => {
      if (route.request().headers()["x-e2e-held"] === undefined) return route.fallback();
      // Answered by the server while still signed in, delivered after.
      const response = await route.fetch();
      asked = true;
      await signOutAnswered;
      return route.fulfill({ response });
    });
    await page.evaluate(() => {
      void fetch("/api/auth/session", { headers: { "x-e2e-held": "1" } }).catch(() => undefined);
    });
    await expect.poll(() => asked).toBe(true);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goto("/history");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fhistory$/);
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeHidden();
  });
});
