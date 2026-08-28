import { adminRequest, endActiveSession, ensureActiveSession, expect, test } from "./fixtures";

/*
 * Flow 2: a member records a unit and finds it again.
 *
 * The two-tap path is the whole product: pick the unit, tap an interest level,
 * save. Everything asserted here is what a member would see standing at a door.
 */

/* A unit no seed row uses, so the assertions describe this run's work. */
const UNIT = "#21-07";

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

  const outing = memberPage.getByRole("link").filter({ hasText: "Blk 123" }).first();
  await expect(outing).toBeVisible();
  await outing.click();

  await expect(memberPage.getByRole("heading", { level: 1, name: "Your records" })).toBeVisible();
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
