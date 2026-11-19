import { adminRequest, endActiveSession, expect, footTop, test } from "./fixtures";

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
  /* Once the landing page's cards have loaded, New session is in view and
     clear of the bottom nav without a scroll: it sat under the nav on a
     664px iPhone. */
  await adminPage.goto("/admin/sessions", { waitUntil: "networkidle" });
  const create = adminPage.getByRole("button", { name: "New session" });
  await expect(create).toBeVisible();
  expect(
    await create.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.bottom - 2);
      return window.scrollY === 0 && top !== null && element.contains(top);
    }),
  ).toBe(true);

  await create.click();
  await adminPage.getByLabel("Name this session").fill(TITLE);
  await adminPage.getByRole("button", { name: "Create draft" }).click();

  const row = adminPage.getByRole("listitem").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Draft");

  await row.getByRole("link", { name: new RegExp(TITLE) }).click();
  // The outing's own name heads its page, with a way back to the list.
  await expect(adminPage.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Back to Sessions" })).toBeVisible();
  await expect(adminPage.getByText(/Members cannot record anywhere/)).toBeVisible();

  // Attach a block, then start.
  await adminPage.getByRole("button", { name: "Add blocks" }).click();
  const sheet = adminPage.getByRole("dialog", { name: "Add blocks" });
  await sheet.getByRole("button", { name: /Blk 123/ }).click();
  await sheet.getByRole("button", { name: "Attach 1 block" }).click();
  /* On the outing, not in the sheet that may still be sliding away. */
  await expect(adminPage.getByRole("main").getByText("Blk 123")).toBeVisible();

  await adminPage.getByRole("button", { name: "Start session" }).click();
  await expect(adminPage.getByText("Running now")).toBeVisible();

  // The contingency path: a block added while members are already out.
  await adminPage.getByRole("button", { name: "Add blocks" }).click();
  const second = adminPage.getByRole("dialog", { name: "Add blocks" });
  await second.getByRole("button", { name: /Blk 125/ }).click();
  await second.getByRole("button", { name: "Attach 1 block" }).click();
  await expect(adminPage.getByText(/Members will see it the next time they refresh/)).toBeVisible();
  await expect(adminPage.getByRole("main").getByText("Blk 125")).toBeVisible();

  // Ending asks first, and says what it costs.
  await adminPage.getByRole("button", { name: "End session" }).click();
  const confirm = adminPage.getByRole("alertdialog", { name: "End session" });
  await expect(confirm).toContainText("reopened");
  /* The scrim reaches the bottom edge: it once stopped 20px short, leaving
     the nav undimmed under a destructive question. */
  const scrimBottom = await confirm.evaluate(
    (panel) => panel.closest(".fixed")?.getBoundingClientRect().bottom,
  );
  expect(scrimBottom).toBe(await adminPage.evaluate(() => window.innerHeight));
  await confirm.getByRole("button", { name: "End session" }).click();

  await expect(adminPage.getByText("Ended", { exact: true })).toBeVisible();
  await expect(adminPage.getByText(/visits recorded across 2 blocks/)).toBeVisible();

  // And the way back.
  await adminPage.getByRole("button", { name: "Reopen session" }).click();
  await expect(adminPage.getByText("Running now")).toBeVisible();
});

test("a member sees the block that was added while the outing ran", async ({ memberPage }) => {
  await memberPage.goto("/");
  await expect(memberPage.getByRole("link", { name: /Blk 125/ })).toBeVisible();
});

/*
 * Refused by a partial unique index in the database. The message has to say
 * how to clear it, not surface a constraint name, and is seen: pressed with
 * Start set on what covers the foot of the screen, it once ended under the
 * nav, and at the largest text the row's title kept it there (#213).
 */
test("a second outing cannot be started while one is running", async ({
  adminPage,
  adminApi,
  browserName,
}) => {
  await adminPage.goto("/admin/sessions");

  await adminPage.getByRole("button", { name: "New session" }).click();
  await adminPage.getByLabel("Name this session").fill(CLASHING_TITLE);
  await adminPage.getByRole("button", { name: "Create draft" }).click();

  /* Scoped to the row: Next renders its own route announcer with role="alert",
     so an unscoped query is ambiguous the moment the app has navigated. */
  const row = adminPage.getByRole("listitem").filter({ hasText: CLASHING_TITLE });
  await expect(row).toBeVisible();
  // Newer drafts above it, so its Start can be set on the nav at the default text.
  for (let made = 0; made < 4; made += 1) {
    const later = await adminApi.post("/api/sessions", {
      data: { title: `E2E later draft ${String(made)}` },
    });
    expect(later.status()).toBe(201);
  }
  const start = row.getByRole("button", { name: "Start session" });

  /* At the default text and at the largest (D-111-24); a full load starts
     again at the default. An iPhone shows its install guide regardless,
     floating on the nav at the default size: it is measured once it is there. */
  for (const size of [null, "32px"]) {
    const at = size ?? "the default text size";
    await adminPage.goto("/admin/sessions");
    await expect(start).toBeVisible();
    if (browserName === "webkit") {
      await expect(adminPage.getByRole("region", { name: "Install the app" })).toBeVisible();
    }
    if (size !== null) {
      await adminPage.evaluate((root) => {
        document.documentElement.style.fontSize = root;
      }, size);
    }
    // Two frames for the banner to float or settle into the page at that size.
    await adminPage.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );

    const edge = await footTop(adminPage);
    await start.evaluate((button, top) => {
      window.scrollBy(0, button.getBoundingClientRect().bottom - top);
    }, edge);
    const placed = await start.boundingBox();
    expect(
      placed === null ? null : placed.y + placed.height,
      `Start not set on the nav at ${at}: the list no longer runs past it`,
    ).toBeCloseTo(edge, 0);
    const before = await adminPage.evaluate(() => window.scrollY);
    await start.click();
    const alert = row.getByRole("alert");
    await expect(alert).toContainText(/already active/);
    await expect(start).toBeEnabled();
    await expect(alert).not.toBeFocused();

    const [alertBox, startBox, after, top] = await Promise.all([
      alert.boundingBox(),
      start.boundingBox(),
      adminPage.evaluate(() => window.scrollY),
      footTop(adminPage),
    ]);
    if (alertBox === null || startBox === null) {
      throw new Error(`the message or Start is not drawn at ${at}`);
    }
    const bottom = alertBox.y + alertBox.height;
    expect(startBox.y, `Start above the top of the screen at ${at}`).toBeGreaterThanOrEqual(0);
    expect(bottom, `the message under the nav or its banner at ${at}`).toBeLessThanOrEqual(
      top + 0.5,
    );
    // No further than the message was hidden: onto the nav, not clear of it.
    const moved = after - before;
    const hidden = Math.max(0, bottom + moved - top);
    expect(
      moved,
      `the page moved further than the message was hidden at ${at}`,
    ).toBeLessThanOrEqual(hidden + 1);
  }
});

/*
 * Ended by another admin while this list was open, it went on showing
 * "Running now" and End beside "has already ended" (#226). Read again, the
 * row's End turns into Reopen in place, keeping the sentence and the focus
 * End's confirm gave back.
 */
test("an End refused because the session ended elsewhere shows it ended, and reopening is two taps from the list", async ({
  adminPage,
  adminApi,
}) => {
  await adminPage.goto("/admin/sessions");
  const row = adminPage.getByRole("listitem").filter({ hasText: TITLE });
  const end = row.getByRole("button", { name: "End session" });
  await expect(end).toBeVisible();
  await endActiveSession(adminApi);

  await end.press("Enter");
  await adminPage
    .getByRole("alertdialog", { name: "End session" })
    .getByRole("button", { name: "End session" })
    .press("Enter");

  await expect(row.getByRole("alert")).toContainText("has already ended");
  await expect(row.getByText("Ended", { exact: true })).toBeVisible();
  await expect(end).toHaveCount(0);
  const reopen = row.getByRole("button", { name: "Reopen session" });
  await expect(reopen).toBeFocused();

  /* One tap. Ending by mistake is the failure this guards against, and an
     admin should not have to hunt through a detail screen to undo it. */
  await reopen.click();
  await expect(row).toContainText("Running now");
  await expect(row.getByRole("alert")).toHaveCount(0);
});
