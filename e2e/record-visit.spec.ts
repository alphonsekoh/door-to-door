import type { Locator, Page } from "@playwright/test";
import { uuidv7 } from "../src/lib/uuid";
import { MEMBER_STATE, SEED_BLOCK } from "./accounts";
import {
  adminRequest,
  endActiveSession,
  ensureActiveSession,
  expect,
  test,
  untilLive,
} from "./fixtures";

/*
 * Flow 2: a member records a unit and finds it again.
 *
 * The two-tap path is the whole product: pick the unit, tap an interest level,
 * save. Everything asserted here is what a member would see standing at a door.
 */

/* A unit no seed row uses, so the assertions describe this run's work. */
const UNIT = "#21-07";
/* One door per browser: both run against one database, and a member may
   not suggest a door whose suggestion is still waiting for review. */
const notedUnit = (): string => (test.info().project.name.includes("webkit") ? "#21-12" : "#21-11");

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

/* Wholly on screen and above the bottom nav, as the page first opens; its
   size, rounded to the pixel. Not where it is: resting at the end of a short
   form, it moves with whatever the screen's answers add above it. */
async function clearOfTheNav(
  page: Page,
  target: Locator,
): Promise<{ width: number; height: number }> {
  const [box, nav] = await Promise.all([
    target.boundingBox(),
    page.getByRole("navigation", { name: "Primary" }).boundingBox(),
  ]);
  if (box === null || nav === null) throw new Error("Save or the nav is not on screen");
  expect(box.y, "Save above the top of the screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "Save under the nav").toBeLessThanOrEqual(nav.y + 0.5);
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

/* The docked Save's top less the field's foot: below 0, it is under the bar. */
function clearOfTheBar(field: Locator): Promise<number> {
  return field.evaluate((element) => {
    const bar = document.querySelector('[data-dock="nav"]');
    if (bar === null) throw new Error("no docked Save");
    return Math.round(bar.getBoundingClientRect().top - element.getBoundingClientRect().bottom);
  });
}

/*
 * Taps a field where a thumb scrolling down meets it, its top showing 24px
 * above the docked Save, and says how far it was clear of the bar then. Not
 * click(): that first scrolls a hidden field to the middle of the screen,
 * which no member does, and Chromium counts its scroll margins in doing so.
 */
async function tapAboveTheBar(page: Page, field: Locator): Promise<number> {
  await field.evaluate((element) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const bar = document.querySelector('[data-dock="nav"]');
    if (bar === null) throw new Error("no docked Save");
    const above = bar.getBoundingClientRect().top - element.getBoundingClientRect().top;
    window.scrollBy(0, 24 - above);
  });
  const before = await clearOfTheBar(field);
  const box = await field.boundingBox();
  if (box === null) throw new Error("the field is not on screen");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 10);
  return before;
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

  /* As it first paints, unscrolled, the form clears the pinned Save: a
     header two rows taller once put Add details under it on an iPhone. */
  const details = memberPage.getByRole("button", { name: "Add details" });
  const clear = await details.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && element.contains(top);
  });
  expect(clear, "the Save bar covers Add details").toBe(true);

  /* With the details open the Save bar is pinned, and docks on the nav edge
     to edge: a strip between them once showed the form scrolling through. */
  await details.click();
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

  await memberPage.getByRole("tab", { name: /^All units/ }).click();
  await memberPage.getByLabel("Search this block").fill(UNIT);

  const row = memberPage.getByRole("button", { name: new RegExp(UNIT) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("High");
  await expect(row).toContainText("this session");
});

test("Save is on the first paint, above the nav, before any script has run", async ({
  browser,
}) => {
  /* On a slow first load the server's HTML is all there is, so Save must be
     drawn there, and where it will dock: drawn inside the form, at the
     largest text it sat mostly under the nav until the page went live. */
  for (const size of ["16px", "32px"]) {
    const context = await browser.newContext({
      storageState: MEMBER_STATE,
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    // With scripts off, the text size goes into the HTML itself.
    await page.route(`**/blocks/${SEED_BLOCK}`, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({
        response,
        body: html.replace("<html", `<html style="font-size: ${size}"`),
      });
    });
    await page.goto(`/blocks/${SEED_BLOCK}`);
    /* With no script there is nothing to save with, and it reads so from
       the server's HTML and styles alone (#156). */
    const save = page.getByRole("button", { name: "Getting ready…" });
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(save).toHaveCSS("opacity", "0.6");
    const bar = page.locator('[data-dock="nav"]');
    const [saveBox, navBox, barBox, unitBox] = await Promise.all([
      save.boundingBox(),
      page.getByRole("navigation", { name: "Primary" }).boundingBox(),
      bar.boundingBox(),
      page.getByLabel("Unit number").boundingBox(),
    ]);
    expect(saveBox, `Save at ${size}`).not.toBeNull();
    expect(
      (saveBox?.y ?? 0) + (saveBox?.height ?? 0),
      `Save runs under the nav at ${size}`,
    ).toBeLessThanOrEqual((navBox?.y ?? 0) + 0.5);
    /* And the first thing to fill in is not under it. */
    expect(unitBox, `the unit number at ${size}`).not.toBeNull();
    expect(
      (unitBox?.y ?? 0) + (unitBox?.height ?? 0),
      `the Save bar covers the unit number at ${size}`,
    ).toBeLessThanOrEqual((barBox?.y ?? 0) + 0.5);
    /* Glass where it is pinned, as the live bar will be; clear where it
       rests at the end of the form. */
    const glass = await bar
      .locator(".dock-glass")
      .evaluate((layer) => getComputedStyle(layer).opacity);
    expect(glass, `the Save bar's surface at ${size}`).toBe(size === "32px" ? "1" : "0");
    await context.close();
  }
});

/*
 * A tap scrolls nothing, so a field tapped where its top showed above the
 * docked Save stayed under it, 66px for Notes, with what was typed hidden
 * (#238). The form brings it up to the bar's top.
 */
test("a field tapped where it shows above the docked Save comes clear of it", async ({
  memberPage,
}) => {
  await memberPage.goto(`/blocks/${SEED_BLOCK}`);
  await untilLive(memberPage);
  await memberPage.getByRole("button", { name: "Add details" }).click();
  await expect(memberPage.locator('[data-dock="nav"]')).toHaveAttribute("data-docked", "");

  /* Not Name: at the top of the page on a Pixel 5 it is under by 1px only. */
  for (const label of ["Contact", "Notes"]) {
    const field = memberPage.getByLabel(label, { exact: true });
    /* Under the bar at the tap, so a pass is never a field already clear. */
    expect(await tapAboveTheBar(memberPage, field), `${label} before the tap`).toBeLessThan(0);
    await expect(field).toBeFocused();
    await expect.poll(() => clearOfTheBar(field), `${label} after the tap`).toBe(0);
  }
});

test.describe("typed before the page is live (#113)", () => {
  /* page.route misses requests the service worker makes in WebKit. */
  test.use({ serviceWorkers: "block" });

  test("keeps the unit and the interest level, and Save then saves them", async ({
    memberPage,
  }) => {
    const EARLY_UNIT = "#21-13";
    /* Weak signal: the server's HTML is up, and typed into, well before
       its scripts arrive. Styles still load, so it is drawn as it will be. */
    let arrive: () => void = () => undefined;
    const scripts = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await memberPage.route(/\/_next\/static\/chunks\/[^?]*\.js(\?|$)/, async (route) => {
      await scripts;
      await route.continue();
    });
    await memberPage.goto(`/blocks/${SEED_BLOCK}`, { waitUntil: "commit" });

    const unit = memberPage.getByLabel("Unit number");
    await unit.fill(EARLY_UNIT);
    /* Go on the keyboard: with no script, the form once submitted itself
       and reloaded the page, emptying the field. */
    await unit.press("Enter");
    const high = memberPage.getByRole("radio", { name: "High" });
    await high.click();
    await expect(high).toBeChecked();
    /* The stand-in Save says it is not ready, and a tap on it saves nothing. */
    const standIn = memberPage.getByRole("button", { name: "Getting ready…" });
    await expect(standIn).toBeDisabled();
    await standIn.click({ force: true });

    arrive();
    await untilLive(memberPage);
    /* Once the session is known the form has drawn again, which is when
       a field holding only the server's state lost what was typed. */
    await expect(memberPage.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    await expect(unit).toHaveValue(EARLY_UNIT);
    await expect(high).toBeChecked();
    /* Nothing claims the unit was left out (#119). */
    await expect(memberPage.getByRole("alertdialog", { name: "Not saved" })).toHaveCount(0);
    await expect(memberPage.getByRole("alert").filter({ hasText: "Not saved" })).toHaveCount(0);

    await memberPage.getByRole("button", { name: "Save and next" }).click();
    await expect(
      memberPage.getByRole("status").filter({ hasText: `Saved ${EARLY_UNIT}` }),
    ).toBeVisible();
    await expect(unit).toHaveValue("#21-14");
  });

  /* The shell's scripts cached and the block screen's not, as on a first
     visit or after a deploy: the shell goes live and the session answers
     while the screen is still the server's HTML. */
  test("keeps them when the block screen's own script is the last to arrive", async ({
    memberPage,
  }) => {
    const EARLY_UNIT = "#24-07";
    let typed: () => void = () => undefined;
    const shell = new Promise<void>((resolve) => {
      typed = resolve;
    });
    let arrive: () => void = () => undefined;
    const screen = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await memberPage.route(/\/_next\/static\/chunks\/[^?]*\.js(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await shell;
      /* The recording form's chunk, the only one holding its words. */
      if (body.includes("Enter the unit number")) await screen;
      await route.fulfill({ response, body });
    });
    await memberPage.goto(`/blocks/${SEED_BLOCK}`, { waitUntil: "commit" });

    const unit = memberPage.getByLabel("Unit number");
    await unit.fill(EARLY_UNIT);
    const high = memberPage.getByRole("radio", { name: "High" });
    await high.click();

    /* Asked once the shell is live. */
    const answered = memberPage.waitForResponse("**/api/auth/session");
    typed();
    await answered;
    /* Two frames to take the answer in, which once threw the screen's HTML
       away for the loading screen, and what was typed with it. */
    await memberPage.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    await expect(memberPage.getByText("Loading the block…")).toHaveCount(0);
    await expect(unit).toHaveValue(EARLY_UNIT);
    await expect(high).toBeChecked();

    /* Save reads as not ready while the screen's script is out (#156), in
       view above the nav at the size the live Save will be. */
    const standIn = memberPage.getByRole("button", { name: "Getting ready…" });
    await expect(standIn).toBeDisabled();
    await expect(standIn).toHaveCSS("opacity", "0.6");
    const waiting = await clearOfTheNav(memberPage, standIn);

    arrive();
    await untilLive(memberPage);
    await expect(memberPage.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    await expect(unit).toHaveValue(EARLY_UNIT);
    await expect(high).toBeChecked();

    const save = memberPage.getByRole("button", { name: "Save and next" });
    await expect(standIn).toHaveCount(0);
    await expect(save).toBeEnabled();
    await expect(save).toHaveCSS("opacity", "1");
    expect(
      await clearOfTheNav(memberPage, save),
      "Save changed size as the page went live",
    ).toEqual(waiting);

    await save.click();
    await expect(
      memberPage.getByRole("status").filter({ hasText: `Saved ${EARLY_UNIT}` }),
    ).toBeVisible();
    await expect(unit).toHaveValue("#24-08");
  });

  /* The browser gives a page loaded again from history what its form held.
     The unit does not come back, so a level that did would be taken as
     picked for whatever unit is typed next. */
  test("a level left unsaved is not ticked again when the page comes back from history", async ({
    memberPage,
  }) => {
    await memberPage.goto(`/blocks/${SEED_BLOCK}`);
    await untilLive(memberPage);
    await memberPage.getByLabel("Unit number").fill("#21-15");
    const high = memberPage.getByRole("radio", { name: "High" });
    await high.click();
    await expect(high).toBeChecked();

    /* Left by a full page load, as a sign-out or the offline page is, and
       come back to with Back. */
    await memberPage.goto("/history");
    await memberPage.goBack();
    await untilLive(memberPage);
    await expect(memberPage.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    await expect(memberPage.getByLabel("Unit number")).toHaveValue("");
    await expect(memberPage.getByRole("radio", { checked: true })).toHaveCount(0);
  });
});

test("what the member recorded is on their own history", async ({ memberPage }) => {
  await memberPage.goto("/history");

  /* Outing cards only: the outstanding follow-ups above them name their door
     ("Blk 123 · #06-203") and would otherwise match first. */
  const outing = memberPage.locator('a[href^="/history/"]').filter({ hasText: "Blk 123" }).first();
  await expect(outing).toBeVisible();
  await outing.click();

  await expect(
    memberPage.getByRole("heading", { level: 1, name: "Session records" }),
  ).toBeVisible();
  await expect(memberPage.getByRole("link", { name: new RegExp(UNIT) })).toBeVisible();
});

test("an amendment sticks, and the sheet's save is reachable", async ({ memberPage }) => {
  await memberPage.goto("/");
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();
  await memberPage.getByRole("tab", { name: /^All units/ }).click();
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
  await memberPage.getByRole("tab", { name: /^All units/ }).click();
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

test("a return visit suggested after saving is waiting the next time the unit is typed", async ({
  memberPage,
}) => {
  const NOTED_UNIT = notedUnit();
  await memberPage.goto("/");
  await memberPage.getByRole("link", { name: /Blk 123/ }).click();

  await memberPage.getByLabel("Unit number").fill(NOTED_UNIT);
  await memberPage.getByRole("radio", { name: "Medium" }).click();
  await memberPage.getByRole("button", { name: "Save and next" }).click();
  await expect(memberPage.getByRole("status")).toContainText(`Saved ${NOTED_UNIT}.`);

  await memberPage.getByRole("button", { name: "Suggest a return visit" }).click();
  const sheet = memberPage.getByRole("dialog", { name: `Suggest a return visit, ${NOTED_UNIT}` });
  await sheet.getByLabel("Why should we go back?").fill("Bring the festival flyer on Sunday.");

  /* A flick down the header would throw an empty sheet away. Holding a note
     typed at the door, it gives, springs back and asks instead. Measured
     once it has risen, so the finger lands on the header. */
  await expect
    .poll(() => sheet.evaluate((panel) => getComputedStyle(panel).transform))
    .toBe("none");
  const header = await sheet.getByText("Suggest a return visit").first().boundingBox();
  const x = (header?.x ?? 0) + 20;
  const y = (header?.y ?? 0) + (header?.height ?? 0) / 2;
  await memberPage.mouse.move(x, y);
  await memberPage.mouse.down();
  await memberPage.mouse.move(x, y + 300, { steps: 5 });
  await memberPage.mouse.up();
  const ask = memberPage.getByRole("alertdialog", { name: "Discard this note?" });
  await expectTappable(ask.getByRole("button", { name: "Keep editing" }));
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toBeHidden();
  await expect(sheet.getByLabel("Why should we go back?")).toHaveValue(
    "Bring the festival flyer on Sunday.",
  );

  /* The sheet opens over the recording form and the bottom nav: the same
     place a Save button has been buried before. */
  const save = sheet.getByRole("button", { name: "Send suggestion" });
  await expectTappable(save);
  await save.click();
  await expect(sheet).toBeHidden();
  await expect(memberPage.getByRole("status")).toContainText(
    "Suggestion sent. An admin will review it.",
  );

  /* Back at the same door: the suggestion shows before knocking, so nobody
     suggests it twice. */
  await memberPage.getByLabel("Unit number").fill(NOTED_UNIT);
  const waiting = memberPage.getByRole("list", { name: "Waiting for review" });
  await expect(waiting).toContainText("Bring the festival flyer on Sunday.");
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

  type Frame = { transform: string; opacity: number; scrim: number };

  /* The open sheet's panel and scrim, frame by frame, from just before it
     is opened. */
  async function sampleSheet(page: Page, open: () => Promise<void>): Promise<Frame[]> {
    await page.evaluate(() => {
      const seen: Frame[] = [];
      Reflect.set(window, "__sheetFrames", seen);
      const frame = () => {
        const panel = document.querySelector('[data-state="open"] [role="dialog"]');
        // The backdrop fades when motion is reduced; the dim inside it
        // follows the sheet's travel otherwise. What shows is both.
        const backdrop = panel?.previousElementSibling;
        const dim = backdrop?.firstElementChild;
        if (panel && backdrop && dim) {
          seen.push({
            transform: getComputedStyle(panel).transform,
            opacity: Number(getComputedStyle(panel).opacity),
            scrim:
              Number(getComputedStyle(backdrop).opacity) * Number(getComputedStyle(dim).opacity),
          });
        }
        if (seen.length < 30) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await open();
    await expect
      .poll(() => page.evaluate(() => (Reflect.get(window, "__sheetFrames") as Frame[]).length))
      .toBeGreaterThanOrEqual(30);
    return page.evaluate(() => Reflect.get(window, "__sheetFrames") as Frame[]);
  }

  /* Once shown, never back to transparent: a CSS transition on either once
     replayed the fade from nothing as Motion finished, a one-frame blink. */
  function fadesInOnce(frames: Frame[]): boolean {
    return frames.every(
      (frame, i) =>
        i === 0 ||
        (frame.opacity >= (frames[i - 1]?.opacity ?? 0) &&
          frame.scrim >= (frames[i - 1]?.scrim ?? 0)),
    );
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
    await memberPage.getByRole("tab", { name: /^All units/ }).click();
    await memberPage.getByLabel("Search this block").fill(UNIT);
    const row = memberPage.getByRole("button", { name: new RegExp(UNIT) });

    const moving = await sampleSheet(memberPage, () => row.click());
    expect(moving.some((frame) => frame.transform !== "none")).toBe(true);
    expect(fadesInOnce(moving), "the scrim faded in twice").toBe(true);
    await memberPage.keyboard.press("Escape");
    // Gone from the page, not only from the accessibility tree.
    await expect(memberPage.locator('[data-state="closed"]')).toHaveCount(0);

    await memberPage.emulateMedia({ reducedMotion: "reduce" });
    const still = await sampleSheet(memberPage, () => row.click());
    expect(still.every((frame) => frame.transform === "none")).toBe(true);
    expect(fadesInOnce(still), "the sheet blinked out as its fade ended").toBe(true);
    // The reduced-motion rule gives everything a 0.01ms transition; Motion's
    // layers must not have one.
    const panel = memberPage.getByRole("dialog");
    await expect
      .poll(() => panel.evaluate((element) => getComputedStyle(element).transitionProperty))
      .toBe("none");
  });

  test("a sheet pulled down lightens its scrim as it goes, and settles back", async ({
    memberPage,
  }) => {
    await openBlock(memberPage);
    await memberPage.getByRole("tab", { name: /^All units/ }).click();
    await memberPage.getByLabel("Search this block").fill(UNIT);
    await memberPage.getByRole("button", { name: new RegExp(UNIT) }).click();
    const sheet = memberPage.getByRole("dialog", { name: `Amend ${UNIT}` });
    const risen = () => sheet.evaluate((panel) => getComputedStyle(panel).transform);
    await expect.poll(risen).toBe("none");
    const dim = () =>
      sheet.evaluate((panel) => {
        const layer = panel.previousElementSibling?.firstElementChild;
        return layer ? Number(getComputedStyle(layer).opacity) : Number.NaN;
      });
    expect(await dim()).toBe(1);

    const header = await sheet.getByText(UNIT, { exact: true }).first().boundingBox();
    const x = (header?.x ?? 0) + 10;
    const y = (header?.y ?? 0) + (header?.height ?? 0) / 2;
    await memberPage.mouse.move(x, y);
    await memberPage.mouse.down();
    await memberPage.mouse.move(x, y + 100, { steps: 10 });
    // Lighter while the finger is still down, not only once it lets go.
    await expect.poll(dim).toBeLessThan(0.95);
    expect(await dim()).toBeGreaterThan(0.5);
    // Held still, then let go short of the line: back, and fully dim again.
    await memberPage.waitForTimeout(200);
    await memberPage.mouse.up();
    await expect.poll(risen).toBe("none");
    await expect.poll(dim).toBe(1);
    await expect(sheet).toBeVisible();
  });

  test("the pinned Save still knows it is pinned after the text size changes", async ({
    memberPage,
  }) => {
    // Opened at the default size, then the text made larger, as from
    // Control Centre: the form doubles in height under a bar already shown.
    await openBlock(memberPage);
    await memberPage.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    await memberPage.getByRole("button", { name: "Add details" }).click();
    const bar = memberPage.locator('[data-dock="nav"]');
    // A little of the form still runs on under the bar: it is held on the
    // nav, so it is glass.
    await memberPage.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight - 32);
    });
    await expect(bar).toHaveAttribute("data-docked", "");
    const nav = memberPage.getByRole("navigation", { name: "Primary" });
    const [barBox, navBox] = await Promise.all([bar.boundingBox(), nav.boundingBox()]);
    expect(Math.abs((barBox?.y ?? 0) + (barBox?.height ?? 0) - (navBox?.y ?? 0))).toBeLessThan(1);
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

  /*
   * Twice the base, and the largest iOS accessibility size (53px), which the
   * app holds at twice the base: past that a title was crushed to nothing
   * and a sheet's Save sat under its header.
   */
  for (const size of ["200%", "53px"]) {
    test(`at ${size} text the recording screen reflows rather than overlaps`, async ({
      memberPage,
    }) => {
      await openBlock(memberPage);
      await memberPage.evaluate((fontSize) => {
        document.documentElement.style.fontSize = fontSize;
      }, size);

      // The title keeps room for itself beside the way back.
      const title = memberPage.getByRole("heading", { level: 1, name: "Blk 123" });
      const titleFits = await title.evaluate(
        (element) => element.clientWidth > 0 && element.scrollWidth <= element.clientWidth,
      );
      expect(titleFits, "the title is squeezed").toBe(true);

      // Interest levels wrap onto rows; no label spills out of its tile, the
      // label round each radio.
      const levels = memberPage.getByRole("radio");
      const boxes = await levels.evaluateAll((radios) =>
        radios.map((radio) => {
          const box = radio.getBoundingClientRect();
          const tile = radio.closest("label") ?? radio;
          return {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            fits: tile.scrollWidth <= tile.clientWidth,
          };
        }),
      );
      expect(boxes.every((box) => box.fits)).toBe(true);
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart =
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          expect(apart, "two interest levels overlap").toBe(true);
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

      // A sheet's Save stays clear of its own header, and of the nav.
      await memberPage.getByRole("tab", { name: /^All units/ }).click();
      await memberPage.getByLabel("Search this block").fill(UNIT);
      await memberPage.getByRole("button", { name: new RegExp(UNIT) }).click();
      const sheet = memberPage.getByRole("dialog", { name: `Amend ${UNIT}` });
      await expectTappable(sheet.getByRole("button", { name: "Save changes" }));
    });
  }

  test("at the smallest text size nothing shrinks below the base", async ({ memberPage }) => {
    await openBlock(memberPage);
    // iOS's xSmall text size, which a root font of -apple-system-body follows.
    await memberPage.evaluate(() => {
      document.documentElement.style.fontSize = "14px";
    });

    // 16px in a field, or iOS zooms the page when it takes focus.
    await expect
      .poll(() =>
        memberPage.getByLabel("Unit number").evaluate((field) => getComputedStyle(field).fontSize),
      )
      .toBe("16px");
    // And still 44px for every control a thumb aims for.
    const targets = [
      memberPage.getByRole("link", { name: "Back to Session" }),
      memberPage.getByRole("tab", { name: "Record" }),
      memberPage.getByRole("tab", { name: /^All units/ }),
      memberPage.getByRole("button", { name: "Add details" }),
      memberPage.getByRole("radio", { name: "Low" }),
      memberPage.getByRole("button", { name: "Save and next" }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const nav = await memberPage.getByRole("navigation", { name: "Primary" }).boundingBox();
    expect(nav?.height ?? 0).toBeGreaterThanOrEqual(64);
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
    await untilLive(memberPage);

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
    /* Plain Save: with the session unknown, no next unit is promised. */
    const save = memberPage.getByRole("button", { name: "Save", exact: true });
    await save.click();

    /* Not the route announcer, which is also an alert. */
    const alert = memberPage.getByRole("alert").filter({ hasText: "not saved yet" });
    await expect(alert).toContainText("Could not load the session");
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
    await expect(alert).toContainText("No session is running");
    await expect(alert).toBeInViewport({ ratio: 1 });
    // Known now to be none, so the label says what a save would do again.
    await expect(memberPage.getByRole("button", { name: "Save and next" })).toBeInViewport();
  });
});

test.describe("without signal", () => {
  /* A request the service worker makes is out of page.route's reach in
     WebKit, and after the reload the worker is in charge. The queue is what
     is under test here, not the worker. */
  test.use({ serviceWorkers: "block" });

  /* Fetched once the page is idle, not on the tap: a worker that controls
     the page would serve it offline, but none does on the first visit after
     it installs, nor once Safari has cleared it. */
  test("the list of what is waiting opens without signal, with no worker to serve it", async ({
    memberPage,
  }) => {
    const UNSENT = "#21-23";
    await memberPage.goto("/", { waitUntil: "networkidle" });
    await memberPage.getByRole("link", { name: /Blk 123/ }).click();
    await expect(memberPage.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    await memberPage.context().setOffline(true);

    await memberPage.getByLabel("Unit number").fill(UNSENT);
    await memberPage.getByRole("radio", { name: "High" }).click();
    await memberPage.getByRole("button", { name: "Save and next" }).click();
    await expect(memberPage.getByRole("status")).toContainText(`Saved ${UNSENT} on this phone`);

    await memberPage.getByRole("button", { name: /1 waiting to send/ }).click();
    const sheet = memberPage.getByRole("dialog", { name: "Waiting to send" });
    await expect(sheet).toContainText(UNSENT);
    await sheet.getByRole("button", { name: "Close" }).last().click();
    // Still the recording screen, mid-evening, not an error page.
    await expect(memberPage.getByLabel("Unit number")).toHaveValue("#21-24");
    await memberPage.context().setOffline(false);
  });

  /* Without signal the earlier visits wait to send, so the sync row is pinned
     at the top: the field OK goes back to must come to rest below it, not
     under it. */
  test("a Save with a blank unit says why above the nav, and OK goes back to the unit", async ({
    memberPage,
  }) => {
    const QUEUED = "#21-27";
    await memberPage.route("**/api/visits/sync", (route) => route.abort("internetdisconnected"));
    await memberPage.goto("/");
    await memberPage.getByRole("link", { name: /Blk 123/ }).click();
    await untilLive(memberPage);

    const unit = memberPage.getByLabel("Unit number");
    await unit.fill(QUEUED);
    await memberPage.getByRole("radio", { name: "Medium" }).click();
    await memberPage.getByRole("button", { name: "Save and next" }).click();
    await expect(memberPage.getByRole("status")).toContainText(`Saved ${QUEUED} on this phone`);
    await expect(memberPage.getByRole("button", { name: /1 waiting to send/ })).toBeVisible();

    /* Spaces only, chosen and then scrolled away from, as a member does who
       fills the details in before the unit. */
    await unit.fill("   ");
    await memberPage.getByRole("radio", { name: "High" }).click();
    await memberPage.getByRole("button", { name: "Add details" }).click();
    await memberPage.getByLabel("Notes").fill("Asked us to come back on a weekend morning.");
    await memberPage.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await memberPage.getByRole("button", { name: "Save and next" }).click();

    const dialog = memberPage.getByRole("alertdialog", { name: "Not saved" });
    await expect(dialog).toContainText("This visit could not be saved because:");
    await expect(dialog.getByRole("listitem")).toHaveText(["The unit number is blank."]);
    /* Read out as it opens: focus goes to OK, and the line beside Save is inert. */
    await expect(dialog).toHaveAccessibleDescription(
      /could not be saved because:\s*The unit number is blank\./,
    );
    /* Above the nav and the docked Save: what a tap there lands on is OK. */
    const ok = dialog.getByRole("button", { name: "OK" });
    await expect(ok).toBeFocused();
    await expectTappable(ok);
    await ok.click();

    await expect(dialog).toBeHidden();
    await expect(unit).toBeFocused();
    /* Brought into view clear of the pinned sync row and the docked Save,
       without the scroll this check would otherwise make. */
    await expect(unit).toBeInViewport({ ratio: 1 });
    const clear = await unit.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === element;
    });
    expect(clear, "the unit field is under the pinned sync row").toBe(true);
    await expect(unit).toHaveAttribute("aria-invalid", "true");
  });

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

    await memberPage.getByRole("tab", { name: /^All units/ }).click();
    await memberPage.getByLabel("Search this block").fill(OFFLINE_UNIT);
    const pending = memberPage.getByRole("listitem").filter({ hasText: OFFLINE_UNIT });
    await expect(pending).toContainText("Not sent");

    await memberPage.unroute("**/api/auth/session");
    await memberPage.reload();
    await expect(bar).toBeVisible();
    await memberPage.getByRole("tab", { name: /^All units/ }).click();
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

  /*
   * Drawn under "Show earlier visits", the line saying an older page could
   * not be read landed under the docked Save on an iPhone 13: the tap seemed
   * to do nothing (#160). Tapped where a thumb leaves it, just above the bar.
   */
  test("older visits that cannot be read say so above the docked Save, never pull the page from a note, and come with signal", async ({
    memberPage,
    adminApi,
  }, testInfo) => {
    /* One door per browser, so each has exactly one visit past the page. In
       one batch: one save at a time would meet the per-member limit. Items
       are stored a microsecond apart in request order (D-251-7), and the
       phone keeps that order within the millisecond its times carry, so the
       first is the oldest. */
    const unit = testInfo.project.name.includes("webkit") ? "#61-02" : "#61-01";
    const now = new Date().toISOString();
    const synced = await adminApi.post("/api/visits/sync", {
      data: {
        sentAt: now,
        items: Array.from({ length: 21 }, (_, knock) => ({
          id: uuidv7(),
          blockId: SEED_BLOCK,
          unitNumber: unit,
          interestLevel: "low",
          description: knock === 0 ? "The first knock." : "",
          clientCreatedAt: now,
          updatedAt: now,
        })),
      },
    });
    expect(synced.status()).toBe(200);
    const { results } = (await synced.json()) as {
      results: { status: string; visit: { householdId: string } | null }[];
    };
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: 21 }, () => "applied"),
    );
    const householdId = results[0]?.visit?.householdId;
    if (householdId === undefined) throw new Error("the first visit has no household");
    /* Owed, and long enough that its card leaves room above the control, on
       either phone, to bring the control down to the bar. */
    const listed = await adminApi.post("/api/follow-ups", {
      data: {
        householdId,
        note:
          "Bring the pamphlet in Mandarin and in English. The daughter asked us to come back " +
          "on a weekday evening after seven, when her mother is home from the market, and to " +
          "ring twice, as the bell is faint.",
      },
    });
    expect(listed.status()).toBe(201);
    const { id: noteId } = (await listed.json()) as { id: string };

    try {
      await memberPage.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(unit)}`);
      await untilLive(memberPage);
      const timeline = memberPage.getByRole("list", { name: "Timeline" }).getByRole("listitem");
      await expect(timeline).toHaveCount(20);
      const control = memberPage.getByRole("button", { name: "Show earlier visits" });
      await expect(memberPage.locator('[data-dock="nav"]')).toHaveAttribute("data-docked", "");
      const gap = await control.evaluate((element) => {
        const bar = document.querySelector('[data-dock="nav"]');
        if (bar === null) throw new Error("no docked Save");
        const above = () =>
          bar.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
        window.scrollBy(0, 4 - above());
        return above();
      });
      expect(gap, "the control just above the docked Save").toBeGreaterThanOrEqual(0);
      expect(gap, "the control just above the docked Save").toBeLessThanOrEqual(8);

      const older = (url: URL) =>
        url.pathname === `/api/households/${householdId}` && url.searchParams.get("offset") !== "0";
      await memberPage.route(older, (route) => route.abort("internetdisconnected"));
      await control.click();
      const failure = memberPage
        .getByRole("status")
        .filter({ hasText: "Could not load earlier visits." });
      await expect(failure).toBeVisible();
      await expect
        .poll(
          () =>
            failure.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return (
                box.top >= 0 &&
                box.bottom <= window.innerHeight &&
                top !== null &&
                element.contains(top)
              );
            }),
          { message: "something covers the line" },
        )
        .toBe(true);
      await expect(control).toBeEnabled();
      await expect(timeline).toHaveCount(20);

      /* On poor signal the failure lands late, once the member has moved on
         to the note, and it pulled the page 1,500px up to the line. */
      await memberPage.unroute(older);
      let cut: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        cut = resolve;
      });
      await memberPage.route(older, async (route) => {
        await held;
        await route.abort("internetdisconnected");
      });
      await control.click();
      const loading = memberPage.getByRole("button", { name: "Loading…" });
      await expect(loading).toBeDisabled();
      await memberPage.getByRole("radio", { name: "Low" }).click();
      await memberPage.getByRole("button", { name: "Add details" }).click();
      const notes = memberPage.getByLabel("Notes");
      await tapAboveTheBar(memberPage, notes);
      await notes.fill("Came to the door, asked us back.");
      await expect(loading).not.toBeInViewport();
      await expect(notes).toBeInViewport();
      cut();
      await expect(control).toBeEnabled();
      await expect(failure).toBeAttached();
      await expect(notes).toBeFocused();
      await expect(notes).toBeInViewport();
      await expect(failure).not.toBeInViewport();

      await memberPage.unroute(older);
      await control.click();
      await expect(timeline).toHaveCount(21);
      await expect(timeline.first()).toContainText("The first knock.");
      await expect(control).toBeHidden();
    } finally {
      const removed = await adminApi.post(`/api/follow-ups/${noteId}/remove`, {
        data: { reason: "Test done" },
      });
      expect(removed.status()).toBe(204);
    }
  });
});
