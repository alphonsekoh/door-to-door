import { SEED_BLOCK } from "./accounts";
import {
  adminRequest,
  endActiveSession,
  ensureActiveSession,
  expect,
  test,
  untilLive,
} from "./fixtures";

/*
 * Erasure reaches a phone (#279): a record saved without signal for a unit an
 * admin erases before it is sent is refused when it is, and the member is told
 * it was not kept. The one flow that involves real IndexedDB, a reconnect and
 * the bar's layout together; the rest is Vitest's.
 */

/* One door per browser: both run against one database. */
const unit = (): string => (test.info().project.name.includes("webkit") ? "#21-46" : "#21-45");

/* Blocks the page's own worker so the queue, not the worker, is under test. */
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await adminRequest(playwright, baseURL);
  await endActiveSession(api);
  await api.dispose();
});

test("a record for a unit erased meanwhile is not kept, and the bar says so", async ({
  memberPage,
  adminApi,
}) => {
  const UNIT = unit();
  await memberPage.goto("/", { waitUntil: "networkidle" });
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();
  await untilLive(memberPage);

  /* Once with signal, so the unit exists on the server to be erased. */
  await memberPage.getByLabel("Unit number").fill(UNIT);
  await memberPage.getByRole("radio", { name: "High" }).click();
  await memberPage.getByRole("button", { name: "Save and next" }).click();
  await expect(memberPage.getByRole("status")).toContainText(`Saved ${UNIT}`);
  await expect(memberPage.getByText("All visits sent")).toBeVisible();

  /* Again with none: this one stays on the phone. */
  await memberPage.context().setOffline(true);
  await memberPage.getByLabel("Unit number").fill(UNIT);
  await memberPage.getByRole("radio", { name: "Low" }).click();
  await memberPage.getByRole("button", { name: "Save and next" }).click();
  await expect(memberPage.getByRole("button", { name: /1 waiting to send/ })).toBeVisible();

  /* An admin erases the unit meanwhile. */
  const listed = await adminApi.get(`/api/households?blockId=${SEED_BLOCK}&limit=100`);
  const { data } = (await listed.json()) as {
    data: { household: { id: string; unitNumber: string } }[];
  };
  const household = data.find((entry) => entry.household.unitNumber === UNIT)?.household;
  if (household === undefined) throw new Error(`${UNIT} was not stored`);
  const logged = await adminApi.post("/api/erasure-requests", {
    data: { kind: "household", id: household.id },
  });
  const { id } = (await logged.json()) as { id: string };
  expect((await adminApi.post(`/api/erasure-requests/${id}/erase`)).ok()).toBe(true);

  /* Back in signal, the record is refused for good, not held. */
  await memberPage.context().setOffline(false);
  const bar = memberPage.getByRole("button", { name: /1 not kept/ });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.click();
  const sheet = memberPage.getByRole("dialog", { name: "Records not kept" });
  await expect(sheet).toContainText(UNIT);
  await expect(sheet).toContainText("Not kept");
  await expect(sheet).toContainText(
    "This unit's records were erased after you saved this, so it was not kept.",
  );
});
