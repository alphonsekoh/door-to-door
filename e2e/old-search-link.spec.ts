import { expect, test } from "./fixtures";

/*
 * #163: a link from before D-129-7 still carries `?q=`. The screen takes the
 * term into its search and drops it from the address through the History API,
 * which leans on how Next's router keeps its state in the history entry; the
 * Vitest hook test models that by hand, so only a real browser on the
 * production build shows it still holds.
 */

const OLD_LINK = "/admin/history?q=06-20&interestLevel=no_response";
const KEPT = "/admin/history?interestLevel=no_response";

test("an old link's search term fills the search and leaves the address, with no reload", async ({
  adminPage: page,
}) => {
  await page.goto("/admin/sessions");
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();

  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await page.goto(OLD_LINK);

  await expect(page.getByLabel("Search by unit, name or contact")).toHaveValue("06-20");
  await expect(page).toHaveURL(KEPT);
  // The term filters what the link's interest level alone would show.
  const doors = page.getByRole("main").getByRole("link", { name: /^Blk / });
  await expect(doors).toHaveCount(1);
  await expect(doors).toContainText("#06-201");
  expect(loads).toBe(1);

  // Replaced, not pushed: Back leaves the screen rather than restoring the term.
  await page.goBack();
  await expect(page).toHaveURL("/admin/sessions");
});

test("a signed-out open of an old link keeps its term out of callbackUrl", async ({ page }) => {
  await page.goto(OLD_LINK);
  await expect(page).toHaveURL(`/sign-in?callbackUrl=${encodeURIComponent(KEPT)}`);
});
