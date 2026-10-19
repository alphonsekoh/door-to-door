import type { Locator, Page } from "@playwright/test";
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
   the stacking check jsdom cannot make. An open sheet makes the page behind
   it inert, and hit testing skips inert elements, so a nav painted over the
   sheet would go unseen; the check lifts inert for the instant it looks. */
async function expectTappable(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  await expect
    .poll(
      () =>
        target.evaluate((element) => {
          const inert = [...document.querySelectorAll("[inert]")];
          for (const node of inert) node.removeAttribute("inert");
          try {
            const box = element.getBoundingClientRect();
            const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return top !== null && element.contains(top);
          } finally {
            for (const node of inert) node.setAttribute("inert", "");
          }
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
  /* Named for the block, so the member can see where the next Save lands. */
  await expect(memberPage.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();

  /* With the details open the Save bar is pinned, and docks on the nav edge
     to edge: a strip between them once showed the form scrolling through. */
  await memberPage.getByRole("button", { name: "Add details" }).click();
  const bar = memberPage.locator('[data-dock="nav"]');
  await expect(bar).toHaveAttribute("data-docked", "");
  const nav = memberPage.getByRole("navigation", { name: "Primary" });
  const [barBox, navBox] = await Promise.all([bar.boundingBox(), nav.boundingBox()]);
  expect(Math.abs((barBox?.y ?? 0) + (barBox?.height ?? 0) - (navBox?.y ?? 0))).toBeLessThan(1);
  await memberPage.getByRole("button", { name: "Hide details" }).click();

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
  await expectTappable(save);
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
  /* The page behind cannot be reached, by Tab or by a screen reader: the
     sheet is on the body, so the app around the nav is what goes inert. */
  const nav = memberPage.getByRole("navigation", { name: "Primary" });
  const inertAround = () => nav.evaluate((element) => element.closest("[inert]") !== null);
  await expect.poll(inertAround).toBe(true);

  await memberPage.keyboard.press("Shift+Tab");
  await expect(sheet.getByRole("button", { name: "Save changes" })).toBeFocused();
  await memberPage.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();
  for (let i = 0; i < 12; i += 1) await memberPage.keyboard.press("Tab");
  expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await memberPage.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(row).toBeFocused();
  await expect.poll(inertAround).toBe(false);
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

/*
 * What jsdom cannot see of #111: a press shows before release, sheets travel
 * (and only fade when motion is reduced), the display settings for contrast
 * and transparency are honoured, and the recording screen reflows at large
 * text sizes instead of overlapping.
 */
test.describe("the phone's display settings", () => {
  async function openBlock(page: Page): Promise<void> {
    await page.goto("/");
    await page.getByRole("link", { name: /Blk 123/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
  }

  /* Every computed transform of the open sheet's panel, frame by frame,
     from just before it is opened. */
  async function sampleSheet(page: Page, open: () => Promise<void>): Promise<string[]> {
    await page.evaluate(() => {
      const seen: string[] = [];
      Reflect.set(window, "__sheetFrames", seen);
      const frame = () => {
        const panel = document.querySelector('[data-state="open"] [role="dialog"]');
        if (panel !== null) seen.push(getComputedStyle(panel).transform);
        if (seen.length < 30) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await open();
    await expect
      .poll(() => page.evaluate(() => (Reflect.get(window, "__sheetFrames") as string[]).length))
      .toBeGreaterThanOrEqual(30);
    return page.evaluate(() => Reflect.get(window, "__sheetFrames") as string[]);
  }

  test("a press shows the moment a finger lands, before anything is sent", async ({
    memberPage,
  }) => {
    await openBlock(memberPage);
    const save = memberPage.getByRole("button", { name: "Save and next" });
    const box = await save.boundingBox();
    await memberPage.mouse.move((box?.x ?? 0) + 20, (box?.y ?? 0) + 10);
    await memberPage.mouse.down();
    await expect
      .poll(() => save.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe("none");
    await memberPage.mouse.up();
  });

  test("a sheet rises into place, and only fades when motion is reduced", async ({
    memberPage,
  }) => {
    await openBlock(memberPage);
    await memberPage.getByRole("tab", { name: /^Units/ }).click();
    await memberPage.getByLabel("Search this block").fill(UNIT);
    const row = memberPage.getByRole("button", { name: new RegExp(UNIT) });

    const moving = await sampleSheet(memberPage, () => row.click());
    expect(moving.some((transform) => transform !== "none")).toBe(true);
    await memberPage.keyboard.press("Escape");
    // Gone from the page, not only from the accessibility tree.
    await expect(memberPage.locator('[data-state="closed"]')).toHaveCount(0);

    await memberPage.emulateMedia({ reducedMotion: "reduce" });
    const still = await sampleSheet(memberPage, () => row.click());
    expect(still.every((transform) => transform === "none")).toBe(true);
  });

  test("more contrast gives fields a firmer edge and the nav a solid face", async ({
    memberPage,
  }) => {
    await openBlock(memberPage);
    const field = memberPage.getByLabel("Unit number");
    const nav = memberPage.getByRole("navigation", { name: "Primary" });
    const edge = () => field.evaluate((element) => getComputedStyle(element).borderTopColor);
    const before = await edge();
    await memberPage.emulateMedia({ contrast: "more" });
    await expect.poll(edge).not.toBe(before);
    await expect
      .poll(() => nav.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toBe("none");
  });

  test("less transparency makes the glass solid", async ({ memberPage, browserName }) => {
    test.skip(browserName !== "chromium", "only Chromium can emulate reduced transparency");
    await openBlock(memberPage);
    const nav = memberPage.getByRole("navigation", { name: "Primary" });
    await expect
      .poll(() => nav.evaluate((element) => getComputedStyle(element).backdropFilter))
      .not.toBe("none");

    const cdp = await memberPage.context().newCDPSession(memberPage);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await expect
      .poll(() => nav.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toBe("none");
  });

  test("at twice the text size the recording screen reflows rather than overlaps", async ({
    memberPage,
  }) => {
    await openBlock(memberPage);
    await memberPage.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    // Interest levels wrap onto rows; no label spills out of its button.
    const levels = memberPage.getByRole("radio");
    const boxes = await levels.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          fits: button.scrollWidth <= button.clientWidth,
        };
      }),
    );
    expect(boxes.every((box) => box.fits)).toBe(true);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart, "two interest buttons overlap").toBe(true);
      }
    }

    // Nav labels never wrap; where there is no room they are left to screen readers.
    const nav = memberPage.getByRole("navigation", { name: "Primary" });
    const wrapped = await nav.locator("li a span").evaluateAll((labels) =>
      labels.some((label) => {
        const box = label.getBoundingClientRect();
        const line = Number.parseFloat(getComputedStyle(label).lineHeight);
        return box.height > line * 1.5;
      }),
    );
    expect(wrapped).toBe(false);
    await expect(nav.getByRole("link", { name: "Follow-ups" })).toBeAttached();

    /* From the top of the screen, before any scroll, Save clears the nav.
       Held inside the form, which starts low at this size, it could not
       rise that far and sat half under the nav. */
    await memberPage.evaluate(() => {
      window.scrollTo(0, 0);
    });
    const save = memberPage.getByRole("button", { name: "Save and next" });
    await expect
      .poll(async () => {
        const [saveBox, navBox] = await Promise.all([save.boundingBox(), nav.boundingBox()]);
        return (saveBox?.y ?? Infinity) + (saveBox?.height ?? 0) - (navBox?.y ?? 0);
      })
      .toBeLessThanOrEqual(1);
    const covered = await save.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === null || !element.contains(top);
    });
    expect(covered, "the nav covers Save").toBe(false);

    const overflow = await memberPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("a save that cannot be queued", () => {
  /* page.route misses requests the service worker makes in WebKit. */
  test.use({ serviceWorkers: "block" });

  test("says why beside the Save button, even with the details open", async ({ memberPage }) => {
    /* The home page needs the outing to list the block; the block screen
       is opened without it, as after a reload in a dead spot. */
    await memberPage.goto("/");
    const block = await memberPage.getByRole("link", { name: /Blk 123/ }).getAttribute("href");
    expect(block).not.toBeNull();
    await memberPage.route("**/api/sessions/active", (route) =>
      route.abort("internetdisconnected"),
    );
    await memberPage.goto(block ?? "/");

    await memberPage.getByLabel("Unit number").fill("#21-19");
    await memberPage.getByRole("radio", { name: "Medium" }).click();
    await memberPage.getByRole("button", { name: "Add details" }).click();
    await memberPage.getByLabel("Name").fill("Mdm Lee");
    await memberPage.getByLabel("Contact").fill("9123 4567");
    await memberPage.getByLabel("Religion").selectOption("buddhist");
    await memberPage.getByLabel("Notes").fill("Asked us to come back on a weekend morning.");

    /* Scrolled to the bottom, as a member is after the last field: the top
       of the form, where the failure once showed, is off screen. */
    await memberPage.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const save = memberPage.getByRole("button", { name: "Save and next" });
    await save.click();

    /* Not the route announcer, which is also an alert. */
    const alert = memberPage.getByRole("alert").filter({ hasText: "not saved yet" });
    await expect(alert).toContainText("Could not load the outing");
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport();
    await expect(memberPage.getByLabel("Unit number")).toHaveValue("#21-19");

    /* Signal back, but nothing running: a different reason, same place. */
    await memberPage.unroute("**/api/sessions/active");
    await memberPage.route("**/api/sessions/active", (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "not_found", message: "No session is active." } },
      }),
    );
    await save.click();
    await expect(alert).toContainText("No outing is running");
    await expect(alert).toBeInViewport({ ratio: 1 });
  });
});

test.describe("without signal", () => {
  /* A request the service worker makes is out of page.route's reach in
     WebKit, and after the reload the worker is in charge. The queue is what
     is under test here, not the worker. */
  test.use({ serviceWorkers: "block" });

  test("a visit saved without signal waits on the phone, survives a reload and sends later", async ({
    memberPage,
  }) => {
    const OFFLINE_UNIT = "#21-15";
    /* Cut the sync request rather than the whole network: the page still
     reloads, and it behaves the same on both engines. */
    await memberPage.route("**/api/visits/sync", (route) => route.abort("internetdisconnected"));
    /* Leaving with records unsent asks first; the test means to. */
    memberPage.on("dialog", (dialog) => void dialog.accept());

    await memberPage.goto("/");
    await memberPage.getByRole("link", { name: /Blk 123/ }).click();

    /* Coming back to the app re-checks the session; without signal that
       check fails and reads as signed out. The queue must outlast it. */
    await memberPage.route("**/api/auth/session", (route) => route.abort("internetdisconnected"));
    const checked = memberPage.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/auth/session"),
    );
    await memberPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await checked;

    /* The bar's row is there before anything needs it, so the form does not
       move when it fills in mid-entry. */
    const quiet = memberPage.locator("p", { hasText: "All visits sent" });
    await expect(quiet).toBeVisible();
    const slot = await quiet.boundingBox();
    expect(slot).not.toBeNull();
    await memberPage.getByLabel("Unit number").fill(OFFLINE_UNIT);
    await memberPage.getByRole("radio", { name: "Medium" }).click();
    await memberPage.getByRole("button", { name: "Save and next" }).click();

    /* Saved the moment it is on the phone: the form moves on regardless. */
    await expect(memberPage.getByLabel("Unit number")).toHaveValue("#21-16");
    await expect(memberPage.getByRole("status")).toContainText(
      `Saved ${OFFLINE_UNIT} on this phone`,
    );

    const bar = memberPage.getByRole("button", { name: /1 waiting to send/ });
    await expectTappable(bar);
    const filled = await bar.boundingBox();
    expect(filled?.height).toBe(slot?.height);

    await memberPage.getByRole("tab", { name: /^Units/ }).click();
    await memberPage.getByLabel("Search this block").fill(OFFLINE_UNIT);
    const pending = memberPage.getByRole("listitem").filter({ hasText: OFFLINE_UNIT });
    await expect(pending).toContainText("Not sent");

    await memberPage.unroute("**/api/auth/session");
    await memberPage.reload();
    await expect(bar).toBeVisible();
    await memberPage.getByRole("tab", { name: /^Units/ }).click();
    await memberPage.getByLabel("Search this block").fill(OFFLINE_UNIT);
    await expect(pending).toContainText("Not sent");

    /* The sheet's Retry all must sit above the bottom nav. */
    await bar.click();
    const sheet = memberPage.getByRole("dialog", { name: "Waiting to send" });
    const retryAll = sheet.getByRole("button", { name: "Retry all" });
    await expectTappable(retryAll);

    /* Still no signal, so nothing can have gone and the button is live: the
       tap sends at once. Signal back only after it, as the phone would see
       it, or the queue's own timer could send first and disable the button
       under the tap. */
    const tried = memberPage.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/visits/sync"),
    );
    await retryAll.click();
    await tried;
    await memberPage.unroute("**/api/visits/sync");
    await memberPage.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(sheet).toContainText("Everything has been sent.");
    await sheet.getByRole("button", { name: "Close" }).last().click();
    await expect(bar).toBeHidden();
    await expect(quiet).toBeVisible();
    /* Now a server row: tappable, with no "Not sent" chip. */
    const row = memberPage.getByRole("button", { name: new RegExp(OFFLINE_UNIT) });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Not sent");
  });
});
