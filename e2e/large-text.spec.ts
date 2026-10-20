import type { Locator, Page } from "@playwright/test";
import { SEED_BLOCK } from "./accounts";
import { ensureActiveSession, expect, test } from "./fixtures";

/*
 * Every screen at the largest text the app draws: 32px, twice the base
 * (D-111-24), which an iPhone reaches at its first accessibility size.
 *
 * jsdom lays nothing out, so this is the only place a row squeezed past the
 * screen's edge can be seen. Two did ship: the household header pushed Add
 * follow-up off the right edge and broke the unit number at its hyphen, and
 * the Sessions list squeezed each title to a sliver that painted over its
 * red End session button.
 */

const CAP = "32px";

/* Held for the page's life: a full load starts again at the default. */
async function atCap(page: Page): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, CAP);
}

/*
 * What is wrong with the layout on screen, in words: empty when nothing is.
 * Only the top sheet is checked while one is open, since the page behind it
 * is out of reach. Content that scrolls under the nav or a pinned bar is
 * meant to, so text and controls are only compared within one layer.
 */
function layoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = [];
    const width = document.documentElement.clientWidth;
    const sideways = document.documentElement.scrollWidth - width;
    if (sideways > 0) faults.push(`the screen scrolls sideways by ${String(sideways)}px`);

    const open = document.querySelectorAll(
      '[data-state="open"] > [role="dialog"], [data-state="open"] > [role="alertdialog"]',
    );
    const root = [...open].at(-1) ?? document.body;
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 40)}"`;
    const drawn = (element: Element) => {
      if (element.closest('[aria-hidden="true"]') !== null) return false;
      const box = element.getBoundingClientRect();
      return box.width >= 2 && box.height >= 2 && getComputedStyle(element).visibility !== "hidden";
    };
    const ancestors = (element: Element) => {
      const chain: Element[] = [];
      for (let up: Element | null = element; up !== null && up !== root; up = up.parentElement) {
        chain.push(up);
      }
      return chain;
    };
    /* A fixed or sticky ancestor: what scrolls under it is meant to. */
    const layer = (element: Element) =>
      ancestors(element).find((up) => ["fixed", "sticky"].includes(getComputedStyle(up).position));
    const clips = (element: Element) => getComputedStyle(element).overflowX !== "visible";

    const controls = [
      ...root.querySelectorAll("a[href], button, input, select, textarea, [role='radio']"),
    ].filter(drawn);
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const offScreen = box.right > width + 0.5 || box.left < -0.5;
      if (offScreen && !ancestors(control).some(clips)) {
        faults.push(`${name(control)} is past the edge of the screen`);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || node.textContent?.trim() === "" || !drawn(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      // Each line as drawn: cut by whatever clips it, as truncate does.
      const clippers = ancestors(parent)
        .filter(clips)
        .map((up) => up.getBoundingClientRect());
      const lines = [...range.getClientRects()]
        .map((line) => {
          const left = Math.max(line.left, ...clippers.map((box) => box.left));
          const right = Math.min(line.right, ...clippers.map((box) => box.right));
          return new DOMRect(left, line.top, right - left, line.height);
        })
        .filter((line) => line.width > 0.5);

      const own = parent.getBoundingClientRect();
      // Kept spaces (a typed note) hang past the end of each line unseen.
      const hangs = getComputedStyle(parent).whiteSpace.startsWith("pre");
      const spills = lines.some(
        (line) => line.right > own.right + 1.5 || line.left < own.left - 1.5,
      );
      if (spills && !hangs) {
        faults.push(`${name(parent)} spills out of its box`);
      }
      if (/^#\d+-\d+\w*$/.test(node.textContent?.trim() ?? "")) {
        const rows = new Set(lines.map((line) => Math.round(line.top)));
        if (rows.size > 1) faults.push(`unit ${name(parent)} breaks across lines`);
      }
      const here = layer(parent);
      for (const control of controls) {
        if (control.contains(parent) || layer(control) !== here) continue;
        const box = control.getBoundingClientRect();
        const over = lines.some(
          (line) =>
            Math.min(line.right, box.right) - Math.max(line.left, box.left) > 2 &&
            Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top) > 2,
        );
        if (over) faults.push(`${name(parent)} is drawn over ${name(control)}`);
      }
    }
    return [...new Set(faults)];
  });
}

async function expectFits(page: Page, screen: string, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await expect.poll(() => layoutFaults(page), { message: screen }).toEqual([]);
}

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

test("a member's screens fit at the largest text", async ({ memberPage: page }) => {
  await page.goto("/");
  await atCap(page);
  await expectFits(page, "Session", page.getByRole("link", { name: /Blk 123/ }));

  await page.goto(`/blocks/${SEED_BLOCK}`);
  await atCap(page);
  await page.getByRole("button", { name: "Add details" }).click();
  await expectFits(page, "recording a visit", page.getByLabel("Notes"));
  await page.getByRole("tab", { name: /^All units/ }).click();
  const unit = page.getByRole("main").getByRole("listitem").getByRole("button").first();
  await expectFits(page, "the block's units", unit);
  await unit.click();
  await expectFits(page, "amending a visit", page.getByRole("dialog"));
  await page.keyboard.press("Escape");

  await page.goto("/history");
  await atCap(page);
  const session = page.locator('main a[href^="/history/"]').first();
  await expectFits(page, "History", session);
  await session.click();
  await page.waitForURL(/\/history\/.+/);
  await expectFits(
    page,
    "a session's records",
    page.locator('main li a[href^="/households/"]').first(),
  );

  await page.goto("/follow-ups");
  await atCap(page);
  const door = page.locator('main a[href^="/households/"]').first();
  await expectFits(page, "Follow-ups", door);
  await door.click();
  await page.waitForURL(/\/households\//);
  await expectFits(page, "a household", page.getByRole("button", { name: "Add follow-up" }));
  await page.getByRole("button", { name: "Add follow-up" }).click();
  await expectFits(page, "adding a follow-up", page.getByRole("dialog"));
  await page.keyboard.press("Escape");

  await page.goto("/account");
  await atCap(page);
  await expectFits(page, "Account", page.getByRole("heading", { level: 1 }));
});

test("an admin's screens fit at the largest text", async ({ adminPage: page, adminApi }) => {
  const id = await ensureActiveSession(adminApi);
  await page.goto("/admin/sessions");
  await atCap(page);
  await expectFits(page, "Sessions", page.getByRole("button", { name: "End session" }));

  await page.goto(`/admin/sessions/${id}`);
  await atCap(page);
  await expectFits(page, "a session", page.getByRole("button", { name: "Add blocks" }));

  await page.goto("/admin/records");
  await atCap(page);
  const record = page.getByRole("button", { name: "Record for a member" });
  await expectFits(page, "Records", record);
  await record.click();
  await expectFits(page, "recording for a member", page.getByRole("dialog"));
  await page.keyboard.press("Escape");

  await page.goto("/admin/history");
  await atCap(page);
  await expectFits(page, "All records", page.locator('main a[href^="/households/"]').first());

  await page.goto("/admin/attention");
  await atCap(page);
  await expectFits(page, "Needs a return visit", page.getByRole("heading", { level: 1 }));

  await page.goto("/admin/team");
  await atCap(page);
  await expectFits(page, "Team", page.getByRole("button", { name: "Add someone" }));
});
