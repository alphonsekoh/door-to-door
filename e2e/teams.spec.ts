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
  /* Polled: a late layout shift must not decide the outcome (D-74-12). */
  await expect
    .poll(
      () =>
        target.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top !== null && element.contains(top);
        }),
      { message: "something covers the button" },
    )
    .toBe(true);
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

  await memberPage.getByRole("button", { name: "Pair up", exact: true }).click();
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

  await partnerPage.getByRole("button", { name: "Leave", exact: true }).click();
  const confirm = partnerPage.getByRole("alertdialog", { name: "Leave this team?" });
  const leave = confirm.getByRole("button", { name: "Leave team" });
  await expectTappable(leave);
  await leave.click();

  await expect(partnerPage.getByRole("button", { name: "Pair up", exact: true })).toBeVisible();
  await expect(partnerPage.getByText("Alice & Ben", { exact: true })).toHaveCount(0);
});

const BEN = "00000000-0000-4000-8000-000000000003";

/* The on-screen keyboard leaves roughly this much height. The sticky footer
   must not sit on top of the field being typed in. */
const KEYBOARD_UP_HEIGHT = 340;

async function expectFieldClear(page: Page, field: Locator): Promise<void> {
  await field.focus();
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === element;
      }),
    )
    .toBe(true);
  await expect(field).toBeInViewport({ ratio: 1 });
  expect(page.viewportSize()?.height).toBe(KEYBOARD_UP_HEIGHT);
}

test("the team name stays visible with the keyboard up", async ({
  memberPage,
  partnerPage,
  adminApi,
}) => {
  const active = await memberPage.request.get("/api/sessions/active");
  const { session } = (await active.json()) as { session: { id: string } };
  await partnerPage.request.post(`/api/sessions/${session.id}/join`);
  await memberPage.request.post(`/api/sessions/${session.id}/join`);
  /* A longer picker is what pushes the name field toward the footer. */
  await adminApi.post(`/api/sessions/${session.id}/join`);

  await memberPage.goto("/");
  const width = memberPage.viewportSize()?.width ?? 393;
  await memberPage.getByRole("button", { name: "Pair up", exact: true }).click();
  await memberPage.setViewportSize({ width, height: KEYBOARD_UP_HEIGHT });

  const create = memberPage.getByRole("dialog", { name: "Pair up" });
  await create.getByRole("button", { name: /Ben Lim/ }).click();
  await expectFieldClear(memberPage, create.getByLabel(/Team name/));
  await create.getByRole("button", { name: "Cancel" }).click();

  await memberPage.request.post(`/api/sessions/${session.id}/teams`, {
    data: { name: "Alice & Ben", memberIds: [BEN] },
  });
  await memberPage.setViewportSize({ width, height: 800 });
  await memberPage.reload();
  await memberPage.getByRole("button", { name: "Rename", exact: true }).click();
  await memberPage.setViewportSize({ width, height: KEYBOARD_UP_HEIGHT });
  await expectFieldClear(
    memberPage,
    memberPage.getByRole("dialog", { name: "Rename team" }).getByLabel(/Team name/),
  );
});
