import type { Locator } from "@playwright/test";
import { SEED_BLOCK } from "./accounts";
import { endActiveSession, expect, test, untilLive } from "./fixtures";

/*
 * Follow-up sessions, end to end: what jsdom cannot show is that the list's
 * rows really carry the unit to the block screen, and that each sheet's and
 * form's button is what a tap lands on, above the bottom nav.
 */

/* #05-123 in the seed: on the follow-up list since the June visit. */
const LISTED_UNIT = "#05-123";
/* #06-201 in the seed: never answered, and nothing asked for. */
const QUIET_HOUSEHOLD = "00000000-0000-4000-8003-000000000003";

/* In view and what a tap there lands on, with nothing drawn over it. */
async function expectTappable(target: Locator): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== null && (element.contains(top) || top.contains(element));
      }),
    )
    .toBe(true);
}

test.afterEach(async ({ adminApi }) => {
  await endActiveSession(adminApi);
});

test("a member records only the households on a follow-up session's list", async ({
  memberPage,
  adminApi,
}) => {
  await endActiveSession(adminApi);
  const created = await adminApi.post("/api/sessions", {
    data: { title: "Follow-up visits", kind: "follow_up", blockIds: [SEED_BLOCK] },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await adminApi.post(`/api/sessions/${id}/start`)).ok()).toBe(true);

  await memberPage.goto("/");
  await expect(
    memberPage.getByText("You can record visits only at the households listed below."),
  ).toBeVisible();
  const list = memberPage.getByRole("region", { name: "Households to revisit" });
  const row = list.locator(`a[href*="?unit=${encodeURIComponent(LISTED_UNIT)}"]`);
  await expect(row).toBeVisible();

  /* A tap on the household arrives with its unit filled in. */
  await row.click();
  await memberPage.waitForURL(new RegExp(`/blocks/${SEED_BLOCK}\\?unit=`));
  await untilLive(memberPage);
  const unit = memberPage.getByLabel("Unit number");
  await expect(unit).toHaveValue(LISTED_UNIT);

  /* A unit off the list is explained, and Save refuses it beside the button. */
  await unit.fill("#09-999");
  await expect(
    memberPage.getByText("#09-999 is not on the follow-up list", { exact: false }),
  ).toBeVisible();
  await memberPage.getByRole("radio", { name: "High" }).click();
  const save = memberPage.getByRole("button", { name: "Save and next" });
  await expectTappable(save);
  await save.click();
  await expect(memberPage.getByRole("alert").filter({ hasText: "Not saved." })).toHaveText(
    "Not saved. This unit is not on the follow-up list.",
  );

  /* A listed unit, picked from the chips, saves; the form then points back
     to the list rather than guessing the next door. */
  await memberPage
    .getByRole("list", { name: "On the list in this block" })
    .getByRole("button", { name: LISTED_UNIT, exact: false })
    .click();
  await expect(unit).toHaveValue(LISTED_UNIT);
  await memberPage.getByRole("radio", { name: "Medium" }).click();
  await expectTappable(save);
  await save.click();
  const status = memberPage.getByRole("status").filter({ hasText: `Saved ${LISTED_UNIT}` });
  await expect(status).toBeVisible();
  await expect(status.getByRole("link", { name: "Back to the list" })).toBeVisible();
  await expect(unit).toHaveValue("");
});

test("a member's suggestion is reviewed by an admin, and the member is told it was declined", async ({
  memberPage,
  adminPage,
}) => {
  const note = `Asked us back after 7pm (${String(Date.now())})`;

  await memberPage.goto(`/households/${QUIET_HOUSEHOLD}`);
  await memberPage.getByRole("button", { name: "Suggest a return visit" }).first().click();
  const sheet = memberPage.getByRole("dialog", { name: /^Suggest a return visit/ });
  await sheet.getByLabel("Why should we go back?").fill(note);
  /* The sheet sits over the bottom nav: its button must be what a tap hits. */
  const send = sheet.getByRole("button", { name: "Send suggestion" });
  await expectTappable(send);
  await send.click();
  await expect(sheet).toBeHidden();
  await expect(memberPage.getByText("Suggestion sent. An admin will review it.")).toBeVisible();
  await expect(memberPage.getByText("Suggested by you, waiting for review")).toBeVisible();

  await adminPage.goto("/admin/follow-ups?tab=review");
  const item = adminPage.getByRole("listitem").filter({ hasText: note });
  await item.getByRole("button", { name: "Dismiss" }).click();
  const dismiss = adminPage.getByRole("dialog", { name: "Dismiss this suggestion?" });
  await dismiss.getByLabel("Reason (optional)").fill("Visited last week");
  const confirm = dismiss.getByRole("button", { name: "Dismiss suggestion" });
  await expectTappable(confirm);
  await confirm.click();
  await expect(item).toBeHidden();

  await memberPage.goto("/follow-ups");
  const declined = memberPage.getByRole("region", { name: "Not added to the follow-up list" });
  const entry = declined.getByRole("listitem").filter({ hasText: note });
  await expect(entry).toContainText("Declined by Admin User");
  await expect(entry).toContainText("Reason: Visited last week");
  await entry.getByRole("button", { name: "Got it" }).click();
  await expect(entry).toBeHidden();
});
