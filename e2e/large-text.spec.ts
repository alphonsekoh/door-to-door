import type { Locator, Page } from "@playwright/test";
import { uuidv7 } from "../src/lib/uuid";
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
 * screen, enough to cover the card a member was about to tap. Then the
 * recording screen opened with its unit number under the docked Save, the
 * sync bar's count and the offline line were cut short, and Amend was drawn
 * over the units in a running session's records.
 */

const CAP = "32px";

/* Held for the page's life: a full load starts again at the default. */
async function atSize(page: Page, size: string): Promise<void> {
  await page.evaluate((root) => {
    document.documentElement.style.fontSize = root;
  }, size);
}

async function atCap(page: Page): Promise<void> {
  await atSize(page, CAP);
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
    /* Hidden for good, as a row held empty is; a scroller's content can
       still be scrolled into view, so it is still checked. */
    const hides = (element: Element) =>
      ["hidden", "clip"].includes(getComputedStyle(element).overflowY);

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
      const hiders = ancestors(parent)
        .filter(hides)
        .map((up) => up.getBoundingClientRect());
      const lines = [...range.getClientRects()]
        .map((line) => {
          const left = Math.max(line.left, ...clippers.map((box) => box.left));
          const right = Math.min(line.right, ...clippers.map((box) => box.right));
          const top = Math.max(line.top, ...hiders.map((box) => box.top));
          const bottom = Math.min(line.bottom, ...hiders.map((box) => box.bottom));
          return new DOMRect(left, top, right - left, bottom - top);
        })
        .filter((line) => line.width > 0.5 && line.height > 0.5);

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

/*
 * In view and uncovered as the screen stands, without scrolling to it: a
 * check that scrolls first passes a field the docked Save sits on as the
 * screen opens. Its corners and middle are each what a tap there reaches.
 */
async function expectInView(target: Locator, what: string): Promise<void> {
  await expect
    .poll(
      () =>
        target.evaluate((element) => {
          const box = element.getBoundingClientRect();
          if (box.top < 0 || box.bottom > window.innerHeight) return "out of view";
          const inset = 2;
          const points = [
            [box.left + inset, box.top + inset],
            [box.right - inset, box.top + inset],
            [box.left + box.width / 2, box.top + box.height / 2],
            [box.left + inset, box.bottom - inset],
            [box.right - inset, box.bottom - inset],
          ] as const;
          const covered = points.some(([x, y]) => {
            const top = document.elementFromPoint(x, y);
            return top === null || !(element.contains(top) || top.contains(element));
          });
          return covered ? "covered" : "in view";
        }),
      { message: what },
    )
    .toBe("in view");
}

/* Its text whole, with nothing cut off by an ellipsis or its box. */
async function expectWhole(target: Locator, what: string): Promise<void> {
  await expect(target).toBeVisible();
  await expect
    .poll(() => target.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), {
      message: `${what} is cut short`,
    })
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

/* A wide unit number, and a note long enough to be cut to its line. */
const WIDE_UNIT = "#12-1234A";

test("a member's screens fit at the largest text", async ({ memberPage: page, adminApi }) => {
  const running = await ensureActiveSession(adminApi);
  const recorded = await page.request.post("/api/visits", {
    data: {
      id: uuidv7(),
      blockId: SEED_BLOCK,
      unitNumber: WIDE_UNIT,
      interestLevel: "low",
      description: "Spoke at the door about the lift upgrading and the playground",
    },
  });
  expect(recorded.status()).toBe(201);

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
  /* The running session, where the member's own records offer Amend beside
     them: an ended one has nothing beside its units to squeeze them. */
  const session = page.locator(`main a[href="/history/${running}"]`);
  await expectFits(page, "History", session);
  await session.click();
  await page.waitForURL(`**/history/${running}`);
  await expectFits(
    page,
    "a running session's records",
    page.getByRole("button", { name: `Amend ${WIDE_UNIT}` }).first(),
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

test("the recording screen opens with its unit number in view, at every text size", async ({
  memberPage: page,
}) => {
  await page.goto(`/blocks/${SEED_BLOCK}`);
  await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
  const unit = page.getByLabel("Unit number");
  const back = page.getByRole("link", { name: "Back to Session" });
  /* From the default to the cap, through the sizes either side of where
     the screen turns compact on each phone. */
  for (const size of ["16px", "20px", "23px", "25px", "26px", "27px", "28px", "30px", "32px"]) {
    await atSize(page, size);
    expect(await page.evaluate(() => window.scrollY), "the screen opened scrolled").toBe(0);
    await expectInView(unit, `the unit number at ${size}`);
    const box = await back.boundingBox();
    expect(box?.width, `the way back at ${size}`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `the way back at ${size}`).toBeGreaterThanOrEqual(44);
  }
});

/* The blocks the phone has kept for recording offline. */
function blocksOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("door-to-door-local");
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("copy").objectStore("copy").get("current");
          get.onsuccess = () => {
            const copy = get.result as { blocks?: { block: { id: string } }[] } | undefined;
            db.close();
            resolve((copy?.blocks ?? []).map((entry) => entry.block.id));
          };
        };
      }),
  );
}

test.describe("without signal", () => {
  /* page.route cannot reach a request the service worker makes. */
  test.use({ serviceWorkers: "block" });

  test("with records waiting, the count stays whole and the chrome leaves half the screen", async ({
    memberPage: page,
  }) => {
    await page.route("**/api/visits/sync", (route) => route.abort("internetdisconnected"));
    await page.goto(`/blocks/${SEED_BLOCK}`);
    for (const unit of ["#88-01", "#88-02"]) {
      await page.getByLabel("Unit number").fill(unit);
      await page.getByRole("radio", { name: "High" }).click();
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(page.getByRole("status")).toContainText(`Saved ${unit} on this phone`);
    }
    const bar = page.getByRole("button", { name: /2 waiting to send/ });
    await expect(bar).toBeVisible();

    /* Scrolled to the end first, so whatever is pinned is pinned. */
    const scrolled = async (screen: string) => {
      await atCap(page);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await expect.poll(() => layoutFaults(page), { message: screen }).toEqual([]);
      await expectWhole(bar.getByText("2 waiting to send"), `the count on ${screen}`);
    };
    await scrolled("recording, with records waiting");
    await page.goto("/");
    await scrolled("Session, with records waiting");
  });

  test("the offline shell's line about the records is never cut short", async ({
    memberPage: page,
  }) => {
    /* Home keeps the session on the phone, and the block screen its block. */
    await page.goto("/");
    await page.getByRole("link", { name: /Blk 123/ }).click();
    await expect.poll(() => blocksOnPhone(page)).toContain(SEED_BLOCK);

    /* No answer from the server: the shell says the records are on the phone. */
    await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
    await page.goto("/offline");
    await page.getByRole("button", { name: /^Continue as / }).click();
    const line = page.getByText("Offline. Records save on this phone.");
    await atCap(page);
    await expectFits(page, "the offline shell", line);
    await expectWhole(line, "the offline line");
    await page.getByRole("button", { name: /^Blk 123/ }).click();
    await expectFits(page, "recording offline", page.getByLabel("Unit number"));
    await expectWhole(line, "the offline line");

    /* Then it answers, and the way back out is offered beside the line. */
    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const continueOn = page.getByRole("button", { name: "Continue", exact: true });
    await expectFits(page, "recording offline, back online", continueOn);
    await expectWhole(page.getByText("Back online."), "the back-online line");
  });
});
