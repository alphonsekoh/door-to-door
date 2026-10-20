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
 * red End session button. Then rows that stayed inside the screen squeezed
 * a column instead, cutting a street to "Ang M…" and setting "Blk" over
 * "123"; and on an iPhone the install banner and the nav took 60% of the
 * screen, enough to cover the card a member was about to tap.
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
 * meant to, so text and controls are only compared within one layer; how
 * much of the screen that chrome takes is checked on its own.
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
    /* The page's margin: a control that starts inside it and is pushed
       through it by a row too full. A bar that bleeds edge to edge on
       purpose starts outside it. */
    const main = root.querySelector("main");
    const page = main === null ? null : main.getBoundingClientRect();
    const margin = main === null ? 0 : parseFloat(getComputedStyle(main).paddingRight);
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const offScreen = box.right > width + 0.5 || box.left < -0.5;
      if (offScreen && !ancestors(control).some(clips)) {
        faults.push(`${name(control)} is past the edge of the screen`);
      } else if (
        page !== null &&
        main?.contains(control) === true &&
        box.left >= page.left + margin - 0.5 &&
        box.right > page.right - margin + 1
      ) {
        faults.push(`${name(control)} is pushed into the page's margin`);
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

    /*
     * A column squeezed beside something else to under 12ch of body text,
     * the width the title rows keep (D-111-25), with its text cut short or
     * set a word a line. Such a column neither spills nor overlaps, so the
     * checks above pass it. Alone on its line, text may wrap however the
     * screen makes it; short text on one line, a count or a chip, is fine
     * at any width.
     */
    const probe = document.createElement("span");
    probe.style.cssText = "position: absolute; visibility: hidden; width: 12ch";
    document.body.append(probe);
    const twelve = probe.getBoundingClientRect().width;
    probe.remove();
    const besideAnother = (element: Element) => {
      const box = element.getBoundingClientRect();
      return [...(element.parentElement?.children ?? [])].some((other) => {
        if (other === element || !drawn(other)) return false;
        const near = other.getBoundingClientRect();
        const sameLine = Math.min(near.bottom, box.bottom) - Math.max(near.top, box.top) > 2;
        return sameLine && (near.left >= box.right - 1 || near.right <= box.left + 1);
      });
    };
    /* The box, or a wrapper as wide as it, sharing a line with a sibling. */
    const squeezed = (box: Element) => {
      const width = box.getBoundingClientRect().width;
      for (let up: Element | null = box; up !== null && up !== root; up = up.parentElement) {
        if (Math.abs(up.getBoundingClientRect().width - width) > 1) return false;
        if (besideAnother(up)) return true;
      }
      return false;
    };
    const boxes = new Set<Element>();
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = textWalker.nextNode(); node !== null; node = textWalker.nextNode()) {
      let box = node.parentElement;
      while (box !== null && ["inline", "contents"].includes(getComputedStyle(box).display)) {
        box = box.parentElement;
      }
      if (box !== null && node.textContent?.trim() !== "") boxes.add(box);
    }
    for (const box of boxes) {
      if (!drawn(box) || box.matches("input, select, textarea, option")) continue;
      const width = box.getBoundingClientRect().width;
      if (width >= twelve - 0.5 || !squeezed(box)) continue;

      const style = getComputedStyle(box);
      const cut = style.textOverflow === "ellipsis" && box.scrollWidth > box.clientWidth + 1;
      const rows = new Set<number>();
      const inside = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let text = inside.nextNode(); text !== null; text = inside.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const line of range.getClientRects()) {
          if (line.width > 0.5) rows.add(Math.round(line.top));
        }
      }
      const words = box.textContent.trim().split(/\s+/).length;
      const wide = `${String(Math.round(width))}px wide`;
      if (cut) {
        faults.push(`${name(box)} is cut short in a column ${wide}`);
      } else if (rows.size > 1 && rows.size >= words) {
        faults.push(`${name(box)} is set a word a line in a column ${wide}`);
      }
    }

    /*
     * Chrome that stays put - the nav, a pinned Save, a floating banner -
     * leaves the page at least half the screen. Only checked with no sheet
     * open: a sheet is meant to cover the page.
     */
    if (root === document.body) {
      const height = window.innerHeight;
      const spans: [number, number][] = [];
      for (const element of document.body.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        if (!drawn(element)) continue;
        const box = element.getBoundingClientRect();
        if (style.position === "sticky") {
          const top = style.top === "auto" ? null : parseFloat(style.top);
          const bottom = style.bottom === "auto" ? null : parseFloat(style.bottom);
          const stuck =
            (top !== null && Math.abs(box.top - top) < 1) ||
            (bottom !== null && Math.abs(box.bottom - (height - bottom)) < 1);
          if (!stuck) continue;
        }
        spans.push([Math.max(0, box.top), Math.min(height, box.bottom)]);
      }
      spans.sort((a, b) => a[0] - b[0]);
      let covered = 0;
      let reach = 0;
      for (const [top, bottom] of spans) {
        const from = Math.max(top, reach);
        if (bottom > from) covered += bottom - from;
        reach = Math.max(reach, bottom);
      }
      if (covered > height / 2) {
        faults.push(
          `chrome that stays put covers ${String(Math.round((covered / height) * 100))}% of the screen`,
        );
      }
    }
    return [...new Set(faults)];
  });
}

/* In view and what a tap there lands on: inside its box is not enough when
   something fixed is drawn over it. */
async function expectTappable(target: Locator, what: string): Promise<void> {
  await expect
    .poll(
      () =>
        target.evaluate((element) => {
          // Mid-screen, as a member scrolls a thing to tap it: a browser
          // scrolling it only just into view knows nothing of the nav.
          element.scrollIntoView({ block: "center" });
          const box = element.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top !== null && (element.contains(top) || top.contains(element));
        }),
      { message: `something covers ${what}` },
    )
    .toBe(true);
}

async function expectFits(page: Page, screen: string, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await expect.poll(() => layoutFaults(page), { message: screen }).toEqual([]);
  await expectTappable(ready, `the first thing to tap on ${screen}`);
}

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

test("a member's screens fit at the largest text", async ({ memberPage: page }) => {
  await page.goto("/");
  await atCap(page);
  await expectFits(page, "Session", page.getByRole("link", { name: /Blk 123/ }));
  await page.getByRole("button", { name: "Pair up" }).click();
  await expectFits(page, "pairing up", page.getByRole("dialog", { name: "Pair up" }));
  await page.keyboard.press("Escape");

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
  // Its Save is docked, so no banner may float over it.
  await expectTappable(page.getByRole("button", { name: "Save name" }), "Save name");
});

test("an admin's screens fit at the largest text", async ({ adminPage: page, adminApi }) => {
  const id = await ensureActiveSession(adminApi);
  await page.goto("/admin/sessions");
  await atCap(page);
  await expectFits(page, "Sessions", page.getByRole("button", { name: "End session" }));

  await page.goto(`/admin/sessions/${id}`);
  await atCap(page);
  await expectFits(
    page,
    "a session",
    page.getByRole("main").getByRole("listitem").filter({ hasText: "Blk 123" }),
  );
  await page.getByRole("button", { name: "Add blocks" }).click();
  const attach = page.getByRole("dialog", { name: "Add blocks" });
  await expect(attach.getByRole("listitem").first()).toBeVisible();
  await expectFits(page, "adding blocks", attach);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New team" }).click();
  await expectFits(page, "making a team", page.getByRole("dialog", { name: "New team" }));
  await page.keyboard.press("Escape");

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
  await expectFits(
    page,
    "Needs a return visit",
    page.locator('main a[href^="/households/"]').first().or(page.getByText("Nothing is waiting.")),
  );

  await page.goto("/admin/team");
  await atCap(page);
  await expectFits(page, "Team", page.getByRole("button", { name: "Make an admin" }).first());
});
