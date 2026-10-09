import type { Locator, Page } from "@playwright/test";
import { adminRequest, endActiveSession, ensureActiveSession, expect, test } from "./fixtures";

/*
 * Two members on one outing: both join, one pairs up with the other, the other
 * sees the team after a refresh and leaves.
 *
 * Layout is asserted as well as behaviour: the primary action has to be the
 * thing under a thumb at phone width, not hidden beneath the bottom nav.
 */

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await adminRequest(playwright, baseURL);
  await endActiveSession(api);
  await api.dispose();
});

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

/* Teams belong to an outing, so ending it leaves nothing for the next spec. */
test.afterEach(async ({ adminApi }) => {
  await endActiveSession(adminApi);
});

/* In the viewport and actually what a tap would land on: elementFromPoint is
   the stacking check jsdom cannot make. */
async function expectTappable(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  const hit = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && element.contains(top);
  });
  expect(hit, "something covers the button").toBe(true);
}

async function noSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("two members join, pair up, and one leaves", async ({ memberPage, partnerPage }) => {
  for (const page of [memberPage, partnerPage]) {
    await page.goto("/");
    const join = page.getByRole("button", { name: "Join this outing" });
    await expectTappable(join);
    await join.click();
    await expect(page.getByText("You've joined this outing")).toBeVisible();
    await expect(join).toHaveCount(0);
  }

  await memberPage.reload();
  await expect(memberPage.getByText("You've joined this outing")).toBeVisible();

  await memberPage.getByRole("button", { name: "Pair up" }).click();
  const sheet = memberPage.getByRole("dialog", { name: "Pair up" });
  await sheet.getByRole("button", { name: /Ben Lim/ }).click();
  await expect(sheet.getByLabel(/Team name/)).toHaveValue("Alice & Ben");

  const create = sheet.getByRole("button", { name: "Create team" });
  await expectTappable(create);
  await create.click();

  await expect(memberPage.getByText("Alice & Ben", { exact: true })).toBeVisible();
  await expect(memberPage.getByText("Ben Lim", { exact: true })).toBeVisible();
  await noSideScroll(memberPage);

  // Ben sees it once his screen re-reads.
  await partnerPage.getByRole("button", { name: "Refresh" }).click();
  await expect(partnerPage.getByText("Alice & Ben", { exact: true })).toBeVisible();

  await partnerPage.getByRole("button", { name: "Leave" }).click();
  const confirm = partnerPage.getByRole("alertdialog", { name: "Leave this team?" });
  const leave = confirm.getByRole("button", { name: "Leave team" });
  await expectTappable(leave);
  await leave.click();

  await expect(partnerPage.getByRole("button", { name: "Pair up" })).toBeVisible();
  await expect(partnerPage.getByText("Alice & Ben", { exact: true })).toHaveCount(0);
});
