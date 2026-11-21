import { SEED_BLOCK } from "./accounts";
import { expect, test } from "./fixtures";

/*
 * #246: Needs a return visit keeps its block and medium toggle in the address
 * through the History API, as useSearchTerm does (D-163-6). router.replace
 * waits on a server round trip the page has no use for, and offline falls
 * back to a page load the worker answers with Offline. That leans on how
 * Next's router patches replaceState and keeps its state in the entry, which
 * Vitest models by hand, so only a real browser on the production build shows
 * the filters still move, stay put offline and come back on Back.
 *
 * It needs no door on the list, and records none: a visit here would sit in
 * the running session that later specs open.
 */

const SCREEN = "/admin/attention";

test("the block and the toggle move the address without the server, come back on Back, and fail in place offline", async ({
  adminPage: page,
}) => {
  /* The screen's own server round trips, which a filter must not make. */
  const roundTrips: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["rsc"] === "1" && new URL(request.url()).pathname === SCREEN) {
      roundTrips.push(request.url());
    }
  });

  await page.goto(SCREEN);
  const picker = page.getByLabel("Filter by block");
  await expect(picker.getByRole("option", { name: "Blk 123" })).toBeAttached();
  await picker.selectOption({ label: "Blk 123" });
  await expect(page).toHaveURL(`${SCREEN}?blockId=${SEED_BLOCK}`);
  await page.getByRole("button", { name: "Include medium interest" }).click();
  const filtered = `${SCREEN}?blockId=${SEED_BLOCK}&minimumInterest=medium`;
  await expect(page).toHaveURL(filtered);
  const toggle = page.getByRole("button", { name: "High interest only" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(roundTrips).toEqual([]);

  /* Any link away is the same client navigation as a door's, and Back the
     same restore from the entry. */
  await page.getByRole("link", { name: "Back to Sessions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filtered);
  await expect(picker).toHaveValue(SEED_BLOCK);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.context().setOffline(true);
  await picker.selectOption({ label: "All blocks" });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load the list.");
  await expect(page.getByRole("heading", { level: 1, name: "Needs a return visit" })).toBeVisible();
  await expect(page).toHaveURL(`${SCREEN}?minimumInterest=medium`);

  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(picker).toHaveValue("");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});
