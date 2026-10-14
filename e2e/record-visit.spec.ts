import type { Locator } from "@playwright/test";
import { adminRequest, endActiveSession, ensureActiveSession, expect, test } from "./fixtures";

/*
 * Flow 2: a member records a unit and finds it again.
 *
 * The two-tap path is the whole product: pick the unit, tap an interest level,
 * save. Everything asserted here is what a member would see standing at a door.
 */

/* A unit no seed row uses, so the assertions describe this run's work. */
const UNIT = "#21-07";
const NOTED_UNIT = "#21-11";

/* In the viewport and actually what a tap would land on: elementFromPoint is
   the stacking check jsdom cannot make. */
async function expectTappable(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
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

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await adminRequest(playwright, baseURL);
  await endActiveSession(api);
  await api.dispose();
});

test("a member records a unit and sees it in the block list", async ({ memberPage }) => {
  await memberPage.goto("/");

  await memberPage.getByRole("link", { name: /Blk 123/ }).click();
  await expect(memberPage.getByRole("heading", { level: 1, name: "Record a visit" })).toBeVisible();

  await memberPage.getByLabel("Unit number").fill(UNIT);
  await memberPage.getByRole("radio", { name: "High" }).click();

  /* The button has to be reachable without scrolling past the fold - which is
     exactly what was broken until the device pass on #30. */
  const save = memberPage.getByRole("button", { name: "Save and next" });
  await expect(save).toBeInViewport();
  await save.click();

  /* Asserting on state, not a wait: the form clears and suggests the next door
     only once the visit has been accepted. */
  await expect(memberPage.getByLabel("Unit number")).toHaveValue("#21-08");

  await memberPage.getByRole("tab", { name: /^Units/ }).click();
  await memberPage.getByLabel("Search this block").fill(UNIT);

  const row = memberPage.getByRole("button", { name: new RegExp(UNIT) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("High");
  await expect(row).toContainText("tonight");
});

test("what the member recorded is on their own history", async ({ memberPage }) => {
  await memberPage.goto("/history");

  /* Outing cards only: the outstanding follow-ups above them name their door
     ("Blk 123 · #06-203") and would otherwise match first. */
  const outing = memberPage.locator('a[href^="/history/"]').filter({ hasText: "Blk 123" }).first();
  await expect(outing).toBeVisible();
  await outing.click();

  await expect(memberPage.getByRole("heading", { level: 1, name: "Outing records" })).toBeVisible();
  await expect(memberPage.getByRole("link", { name: new RegExp(UNIT) })).toBeVisible();
});

test("an amendment sticks, and the sheet's save is reachable", async ({ memberPage }) => {
  await memberPage.goto("/");
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();
  await memberPage.getByRole("tab", { name: /^Units/ }).click();
  await memberPage.getByLabel("Search this block").fill(UNIT);
  await memberPage.getByRole("button", { name: new RegExp(UNIT) }).click();

  const sheet = memberPage.getByRole("dialog", { name: `Amend ${UNIT}` });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("radio", { name: "Low" }).click();
  const save = sheet.getByRole("button", { name: "Save changes" });
  /* The bug this catches: the bottom nav painted over the sheet, leaving this
     button on screen but untappable. */
  await expect(save).toBeInViewport();
  await save.click();

  await expect(sheet).toBeHidden();
  await expect(memberPage.getByRole("button", { name: new RegExp(UNIT) })).toContainText("Low");
});

test("the amend sheet works from the keyboard alone", async ({ memberPage }) => {
  await memberPage.goto("/");
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();
  await memberPage.getByRole("tab", { name: /^Units/ }).click();
  await memberPage.getByLabel("Search this block").fill(UNIT);

  const row = memberPage.getByRole("button", { name: new RegExp(UNIT) });
  await row.focus();
  await memberPage.keyboard.press("Enter");

  const sheet = memberPage.getByRole("dialog", { name: `Amend ${UNIT}` });
  await expect(sheet).toBeFocused();
  /* The page behind cannot be reached, by Tab or by a screen reader. */
  const nav = memberPage.getByRole("navigation", { name: "Primary" });
  await expect(nav).toHaveAttribute("inert", "");

  await memberPage.keyboard.press("Shift+Tab");
  await expect(sheet.getByRole("button", { name: "Save changes" })).toBeFocused();
  await memberPage.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();
  for (let i = 0; i < 12; i += 1) await memberPage.keyboard.press("Tab");
  expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await memberPage.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(row).toBeFocused();
  await expect(nav).not.toHaveAttribute("inert");
});

test("a follow-up added after saving is waiting the next time the unit is typed", async ({
  memberPage,
}) => {
  await memberPage.goto("/");
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();

  await memberPage.getByLabel("Unit number").fill(NOTED_UNIT);
  await memberPage.getByRole("radio", { name: "Medium" }).click();
  await memberPage.getByRole("button", { name: "Save and next" }).click();
  await expect(memberPage.getByRole("status")).toContainText(`Saved ${NOTED_UNIT}.`);

  await memberPage.getByRole("button", { name: "Add follow-up" }).click();
  const sheet = memberPage.getByRole("dialog", { name: `Follow-up for ${NOTED_UNIT}` });
  await sheet.getByLabel("Note").fill("Bring the festival flyer on Sunday.");

  /* The sheet opens over the recording form and the bottom nav: the same
     place a Save button has been buried before. */
  const save = sheet.getByRole("button", { name: "Save follow-up" });
  await expectTappable(save);
  await save.click();
  await expect(sheet).toBeHidden();
  await expect(memberPage.getByRole("status")).toContainText("Follow-up added.");

  /* Back at the same door: the note shows before knocking. */
  await memberPage.getByLabel("Unit number").fill(NOTED_UNIT);
  const owed = memberPage.getByRole("list", { name: "Outstanding follow-ups" });
  await expect(owed).toContainText("Bring the festival flyer on Sunday.");
  await expectTappable(memberPage.getByRole("button", { name: "Save and next" }));
});
