import { adminRequest, endActiveSession, expect, test } from "./fixtures";

/*
 * Flow 3: the whole life of an outing, as an admin drives it.
 *
 * Create, attach, start, add a block while it runs, end, reopen. Reopening is
 * the one that matters most: ending by mistake locks every member out of
 * amending, and this is the way back.
 */

const TITLE = `E2E lifecycle ${Date.now().toString()}`;
/* Deliberately not a suffix of TITLE: hasText matches on substrings, and a
   second outing whose name contained the first would make every row locator
   below ambiguous. */
const CLASHING_TITLE = `E2E clash ${Date.now().toString()}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  /* Only one outing may be active at a time, so whatever an earlier spec left
     running is closed before this one starts its own. */
  const api = await adminRequest(playwright, baseURL);
  await endActiveSession(api);
  await api.dispose();
});

test("an admin takes an outing from draft to reopened", async ({ adminPage }) => {
  await adminPage.goto("/admin/sessions");

  await adminPage.getByRole("button", { name: "New outing" }).click();
  await adminPage.getByLabel("Name this outing").fill(TITLE);
  await adminPage.getByRole("button", { name: "Create draft" }).click();

  const row = adminPage.getByRole("listitem").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Draft");

  await row.getByRole("link", { name: new RegExp(TITLE) }).click();
  // The outing's own name heads its page, with a way back to the list.
  await expect(adminPage.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Back to Outings" })).toBeVisible();
  await expect(adminPage.getByText(/Members cannot record anywhere/)).toBeVisible();

  // Attach a block, then start.
  await adminPage.getByRole("button", { name: "Add blocks" }).click();
  const sheet = adminPage.getByRole("dialog", { name: "Add blocks" });
  await sheet.getByRole("button", { name: /Blk 123/ }).click();
  await sheet.getByRole("button", { name: "Attach 1 block" }).click();
  /* On the outing, not in the sheet that may still be sliding away. */
  await expect(adminPage.getByRole("main").getByText("Blk 123")).toBeVisible();

  await adminPage.getByRole("button", { name: "Start outing" }).click();
  await expect(adminPage.getByText("Running now")).toBeVisible();

  // The contingency path: a block added while members are already out.
  await adminPage.getByRole("button", { name: "Add blocks" }).click();
  const second = adminPage.getByRole("dialog", { name: "Add blocks" });
  await second.getByRole("button", { name: /Blk 125/ }).click();
  await second.getByRole("button", { name: "Attach 1 block" }).click();
  await expect(adminPage.getByText(/Members will see it the next time they refresh/)).toBeVisible();
  await expect(adminPage.getByRole("main").getByText("Blk 125")).toBeVisible();

  // Ending asks first, and says what it costs.
  await adminPage.getByRole("button", { name: "End outing" }).click();
  const confirm = adminPage.getByRole("alertdialog", { name: "End outing" });
  await expect(confirm).toContainText("reopened");
  /* The scrim reaches the bottom edge: it once stopped 20px short, leaving
     the nav undimmed under a destructive question. */
  const scrimBottom = await confirm.evaluate(
    (panel) => panel.closest(".fixed")?.getBoundingClientRect().bottom,
  );
  expect(scrimBottom).toBe(await adminPage.evaluate(() => window.innerHeight));
  await confirm.getByRole("button", { name: "End outing" }).click();

  await expect(adminPage.getByText("Ended", { exact: true })).toBeVisible();
  await expect(adminPage.getByText(/visits recorded across 2 blocks/)).toBeVisible();

  // And the way back.
  await adminPage.getByRole("button", { name: "Reopen outing" }).click();
  await expect(adminPage.getByText("Running now")).toBeVisible();
});

test("a member sees the block that was added while the outing ran", async ({ memberPage }) => {
  await memberPage.goto("/");
  await expect(memberPage.getByRole("link", { name: /Blk 125/ })).toBeVisible();
});

test("a second outing cannot be started while one is running", async ({ adminPage }) => {
  // Refused by a partial unique index in the database. The message has to say
  // how to clear it, not surface a constraint name.
  await adminPage.goto("/admin/sessions");

  await adminPage.getByRole("button", { name: "New outing" }).click();
  await adminPage.getByLabel("Name this outing").fill(CLASHING_TITLE);
  await adminPage.getByRole("button", { name: "Create draft" }).click();

  const row = adminPage.getByRole("listitem").filter({ hasText: CLASHING_TITLE });
  await row.getByRole("button", { name: "Start outing" }).click();

  /* Scoped to the row: Next renders its own route announcer with role="alert",
     so an unscoped query is ambiguous the moment the app has navigated. */
  await expect(row.getByRole("alert")).toContainText(/already active/);
});

test("reopening is two taps from the outing list", async ({ adminPage, playwright, baseURL }) => {
  const api = await adminRequest(playwright, baseURL);
  await endActiveSession(api);
  await api.dispose();

  await adminPage.goto("/admin/sessions");
  const row = adminPage.getByRole("listitem").filter({ hasText: TITLE });

  /* One tap. Ending by mistake is the failure this guards against, and an
     admin should not have to hunt through a detail screen to undo it. */
  await row.getByRole("button", { name: "Reopen outing" }).click();
  await expect(row).toContainText("Running now");
});
