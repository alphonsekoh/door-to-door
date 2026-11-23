import type { Locator, Page } from "@playwright/test";
import type { VisitSyncRequest, VisitSyncResponse } from "../src/generated/types.gen";
import { uuidv7 } from "../src/lib/uuid";
import { SEED_BLOCK, SEED_MEMBER_ID, SEED_PASSWORD } from "./accounts";
import {
  endActiveSession,
  ensureActiveSession,
  expect,
  listSeededHousehold,
  signInThroughForm,
  startFollowUpSession,
  test,
  untilLive,
} from "./fixtures";

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

      /* An inline box goes wherever its words go, so words it holds on one
         line are measured against the box they are set in: held whole,
         "follow-ups?" ran 16px out of a hint at 320px (#196). */
      let set = parent;
      while (set.parentElement !== null && getComputedStyle(set).display === "inline") {
        set = set.parentElement;
      }
      const own = set.getBoundingClientRect();
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
      /* An interest level's radio is laid over its own label's words. */
      const ownLabel = parent.closest("label");
      for (const control of controls) {
        if (control.contains(parent) || layer(control) !== here) continue;
        if (ownLabel?.contains(control) === true) continue;
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

    return [...new Set(faults)];
  });
}

/*
 * How much of the screen chrome that stays put covers - the nav, a pinned
 * Save or sync bar, a floating banner - as a share of its height. None with
 * a sheet open: a sheet is meant to cover the page.
 */
function chromeShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const open = document.querySelector(
      '[data-state="open"] > [role="dialog"], [data-state="open"] > [role="alertdialog"]',
    );
    if (open !== null) return 0;
    const height = window.innerHeight;
    const spans: [number, number][] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      if (element.closest('[aria-hidden="true"]') !== null) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || style.visibility === "hidden") continue;
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
    return covered / height;
  });
}

/* Everything wrong on screen, the chrome's share included. */
async function screenFaults(page: Page): Promise<string[]> {
  const faults = await layoutFaults(page);
  const share = await chromeShare(page);
  if (share > 0.5) {
    faults.push(`chrome that stays put covers ${String(Math.round(share * 100))}% of the screen`);
  }
  return faults;
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
 * A field taller than the room left for it is checked by its top edge: its
 * two corners and the middle of that edge.
 */
async function expectInView(
  target: Locator,
  what: string,
  part: "whole" | "top edge" = "whole",
): Promise<void> {
  await expect
    .poll(
      () =>
        target.evaluate((element, edgeOnly) => {
          const box = element.getBoundingClientRect();
          const inset = 2;
          const bottom = edgeOnly ? box.top + inset * 2 : box.bottom;
          if (box.top < 0 || bottom > window.innerHeight) return "out of view";
          const edge = [
            [box.left + inset, box.top + inset],
            [box.left + box.width / 2, box.top + inset],
            [box.right - inset, box.top + inset],
          ] as const;
          const rest = [
            [box.left + box.width / 2, box.top + box.height / 2],
            [box.left + inset, box.bottom - inset],
            [box.right - inset, box.bottom - inset],
          ] as const;
          const points = edgeOnly ? edge : [...edge, ...rest];
          const covered = points.some(([x, y]) => {
            const top = document.elementFromPoint(x, y);
            return top === null || !(element.contains(top) || top.contains(element));
          });
          return covered ? "covered" : "in view";
        }, part === "top edge"),
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

/*
 * Drawn on one line, as a word held whole is. One element first, so a word
 * no longer held, and so no longer an element of its own, fails at once
 * rather than when the test runs out of time and its clean-up with it. Its
 * lines are read from a Range over its contents, which an inline element's
 * own boxes and a change of display both leave whole.
 */
async function expectOnOneLine(word: Locator, what: string): Promise<void> {
  await expect(word, `${what}, as one element`).toHaveCount(1);
  expect(
    await word.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
    }),
    `the lines ${what} is drawn on`,
  ).toBe(1);
}

async function expectFits(page: Page, screen: string, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await expect.poll(() => screenFaults(page), { message: screen }).toEqual([]);
  await expectTappable(ready, `the first thing to tap on ${screen}`);
}

test.beforeEach(async ({ adminApi }) => {
  await ensureActiveSession(adminApi);
});

/* A wide unit number, and a note long enough to be cut to its line. */
const WIDE_UNIT = "#12-1234A";

/* #05-125 in the seed: its one note is resolved, so a member may suggest it. */
const RESOLVED_HOUSEHOLD = "00000000-0000-4000-8003-000000000002";

/* #05-123 in the seed: on the follow-up list since the June visit. */
const LISTED_UNIT = "#05-123";

/* #06-201 in the seed: never answered, and nothing asked for. */
const QUIET_HOUSEHOLD = "00000000-0000-4000-8003-000000000003";

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
  /* 320px wide, its hint's title is narrower than "follow-ups?" in CI's
     face: held whole, it ran out of the card rather than break (#196). */
  const phone = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByRole("region", { name: "What are follow-ups?" })).toBeVisible();
  await expectFits(page, "Follow-ups, 320px wide", door);
  if (phone !== null) await page.setViewportSize(phone);
  await door.click();
  await page.waitForURL(/\/households\//);
  // On the list already, so the header says so beside the unit.
  await expectFits(
    page,
    "a household on the list",
    page.getByText("On the follow-up list").first(),
  );

  // Nothing open here, so the header offers a suggestion.
  await page.goto(`/households/${RESOLVED_HOUSEHOLD}`);
  await atCap(page);
  const suggest = page.getByRole("button", { name: "Suggest a return visit" }).first();
  await expectFits(page, "a household", suggest);
  await suggest.click();
  await expectFits(page, "suggesting a return visit", page.getByRole("dialog"));
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

  /* Its tabs carry counts, which must wrap rather than overlap (D-111-25). */
  await page.goto("/admin/follow-ups?tab=list");
  await atCap(page);
  await expectFits(page, "the follow-up list", page.getByRole("button", { name: /^To review/ }));
  /* Its title, as "Follow-" over "up", read as two words (#196). */
  await expectOnOneLine(
    page.getByRole("heading", { level: 1 }).getByText("Follow-up", { exact: true }),
    "Follow-up in the follow-up list's title",
  );
  await expectFits(
    page,
    "a note on the follow-up list",
    page.getByRole("button", { name: "Remove from list" }).first(),
  );

  /* The kind chooser's cards hold a long hint each; a follow-up session
     then lists the households to pick, with Create draft below them. */
  await listSeededHousehold(adminApi);
  await page.goto("/admin/sessions");
  await atCap(page);
  await page.getByRole("button", { name: "New session" }).click();
  const followUpKind = page.getByRole("radio", { name: /Follow-up/ });
  await expectFits(page, "choosing a session's kind", followUpKind);
  await followUpKind.click();
  await expectFits(
    page,
    "picking households",
    page.getByRole("group", { name: "Households to visit" }).getByRole("checkbox").first(),
  );
  await expectTappable(page.getByRole("button", { name: "Create draft" }), "Create draft");

  await page.goto("/admin/team");
  await atCap(page);
  await expectFits(page, "Team", page.getByRole("button", { name: "Make an admin" }).first());
});

/* A member's page is subtitled with their email, which has no space to break
   at, and lists where they are signed in (#125). */
test("a member's page fits at the largest text, whatever the length of their email", async ({
  adminPage: page,
  adminApi,
  browser,
}) => {
  const added = await adminApi.post("/api/users", {
    data: {
      email: `nurul.aisyah.binte.rahman.${String(Date.now())}@example.com.sg`,
      name: "Nurul Aisyah",
      password: SEED_PASSWORD,
    },
  });
  expect(added.status()).toBe(201);
  const member = (await added.json()) as { id: string; email: string };
  const phone = await browser.newContext();
  try {
    await signInThroughForm(await phone.newPage(), member.email);
  } finally {
    await phone.close();
  }

  await page.goto(`/admin/team/${member.id}`);
  await atCap(page);
  await expectFits(
    page,
    "a member's page",
    page.getByRole("button", { name: /^Sign out .*, last used/ }),
  );
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expectFits(page, "signing a member out everywhere", page.getByRole("alertdialog"));
});

/* A follow-up sheet at the cap: how it is opened, at which door, and what
   its note and its Send are called. */
type NoteSheet = {
  door: string;
  open: string;
  title: RegExp;
  note: string;
  send: string;
  /* A hyphenated word in its title, held whole: "follow-" over "up" read
     as two words (#196). */
  whole?: string;
};

const SUGGESTING: NoteSheet = {
  door: RESOLVED_HOUSEHOLD,
  open: "Suggest a return visit",
  title: /^Suggest a return visit/,
  note: "Why should we go back?",
  send: "Send suggestion",
};

/* Its note left blank and refused, and Not saved answered with OK. */
async function refuseBlankNote(
  page: Page,
  { door, open, title, note: field, send }: NoteSheet = SUGGESTING,
): Promise<{ sheet: Locator; note: Locator }> {
  await page.goto(`/households/${door}`);
  await atCap(page);
  await page.getByRole("button", { name: open, exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: title });
  const note = sheet.getByRole("textbox", { name: field });
  await note.fill("   ");
  await sheet.getByRole("button", { name: send }).click();
  const blank = page.getByRole("alertdialog", { name: "Not saved" });
  await blank.getByRole("button", { name: "OK" }).click();
  await expect(blank).toBeHidden();
  await expect(note).toBeFocused();
  return { sheet, note };
}

/*
 * Not saved at the largest text (D-119-13 to D-119-15). With three reasons it
 * is taller than the screen, and focus on OK had opened it scrolled to its
 * foot, the heading half cut away. OK then sends focus to the field at
 * fault, which a sheet's tall note had brought back with its foot on the
 * docked Send and its label and top under the sheet's header. Its label now
 * comes first, whole, with the field under it.
 */
test("Not saved opens at its top, and OK brings the field back below its label", async ({
  memberPage,
  adminPage,
}) => {
  const { sheet } = await refuseBlankNote(memberPage);
  await expectInView(
    sheet.getByText("Why should we go back?", { exact: true }),
    "the note's label after OK",
  );

  await adminPage.goto("/admin/records");
  await atCap(adminPage);
  await adminPage.getByRole("button", { name: "Record for a member" }).click();
  const record = adminPage.getByRole("dialog", { name: "Record on behalf of a member" });
  await record.getByRole("button", { name: "Save the record" }).click();
  const refused = adminPage.getByRole("alertdialog", { name: "Not saved" });
  await expect(refused.getByRole("listitem")).toHaveCount(3);
  const ok = refused.getByRole("button", { name: "OK" });
  await expect(ok).toBeFocused();
  await expectInView(
    refused.getByText("Not saved", { exact: true }),
    "the pop-up's heading as it opens",
  );
  await ok.click();
  await expect(record.getByLabel("Recorded by")).toBeFocused();
  await expectInView(
    record.getByText("Recorded by", { exact: true }),
    "the member's label after OK",
  );
});

/*
 * Under its label, the note's own top edge, on every follow-up sheet. On an
 * iPhone 13 at the cap the room between the sheet's header and its docked
 * Send was shorter than the label and the count, so the note started under
 * Send (D-119-22's known limit, deferred to #136). Send is now drawn at the
 * base size, as the page's docked Save is.
 */
test("OK brings the note back with its top edge in view, on every follow-up sheet", async ({
  memberPage,
  adminPage,
  adminApi,
}) => {
  const listed = await listSeededHousehold(adminApi);
  /* A suggestion of the member's own, for them to edit. */
  const suggested = await memberPage.request.post("/api/follow-ups", {
    data: { householdId: QUIET_HOUSEHOLD, note: "Ask about the lift upgrading" },
  });
  expect(suggested.status()).toBe(201);
  const { id } = (await suggested.json()) as { id: string };
  const sheets: [Page, NoteSheet][] = [
    [memberPage, SUGGESTING],
    [
      memberPage,
      {
        door: QUIET_HOUSEHOLD,
        open: "Edit",
        title: /^Edit suggestion/,
        note: "Why should we go back?",
        send: "Save changes",
      },
    ],
    [
      adminPage,
      {
        door: RESOLVED_HOUSEHOLD,
        open: "Add to follow-up list",
        title: /^Add to the follow-up list/,
        note: "What should the next visit do?",
        send: "Add to list",
        whole: "follow-up",
      },
    ],
    [
      adminPage,
      {
        door: listed,
        open: "Edit",
        title: /^Edit follow-up/,
        note: "What should the next visit do?",
        send: "Save changes",
        whole: "follow-up",
      },
    ],
  ];
  try {
    for (const [page, sheet] of sheets) {
      const { sheet: open, note } = await refuseBlankNote(page, sheet);
      await expectInView(note, `the note's top edge after OK, ${sheet.open}`, "top edge");
      if (sheet.whole !== undefined) {
        await expectOnOneLine(
          open.getByText(sheet.whole, { exact: true }),
          `${sheet.whole} in the title of ${sheet.title.source}`,
        );
      }
    }
  } finally {
    /* Left as it found the door: nothing asked for. */
    const removed = await adminApi.post(`/api/follow-ups/${id}/remove`, {
      data: { reason: "Test done" },
    });
    expect(removed.status()).toBe(204);
  }
});

/*
 * Without signal a follow-up sheet's Send is grey, and the line above it
 * says why. The bar is chrome, at the base size as the page's docked Save
 * is, but that line is content: drawn at the base it was 12px at every text
 * size. A field taking focus is kept clear of the bar as it is drawn, the
 * line and all: kept clear of the bar without it, it could end under it.
 */
test("without signal, a follow-up sheet says why Send is grey at the text size, and keeps a field clear of all of it", async ({
  memberPage: page,
}) => {
  await page.goto(`/households/${RESOLVED_HOUSEHOLD}`);
  await atCap(page);
  /* Once the door has loaded: its history is fetched from the page. */
  const suggest = page.getByRole("button", { name: SUGGESTING.open, exact: true }).first();
  await expect(suggest).toBeVisible();
  await page.context().setOffline(true);
  try {
    await suggest.click();
    const sheet = page.getByRole("dialog", { name: SUGGESTING.title });
    const send = sheet.getByRole("button", { name: SUGGESTING.send });
    await expect(send).toBeDisabled();
    /* A caption, three quarters of the 32px text. */
    await expect(sheet.getByText("Connect to change follow-ups")).toHaveCSS("font-size", "24px");
    /* The room the sheet's body keeps under a field taking focus, less the
       bar Send sits in: the 16px margin. */
    await expect
      .poll(
        () =>
          send.evaluate((button) => {
            const bar = button.parentElement;
            const body = bar?.closest("[data-sheet-body]");
            if (!bar || !body) return null;
            return parseFloat(getComputedStyle(body).scrollPaddingBottom) - bar.offsetHeight;
          }),
        { message: "the room kept under a field taking focus, less the bar" },
      )
      .toBe(16);
  } finally {
    await page.context().setOffline(false);
  }
});

/*
 * Installed on an iPhone, a sheet's body keeps padding under its bar for the
 * home indicator, and the bar rests above that padding. The room kept under
 * what the sheet scrolls into view was counted from the body's edge, so a
 * field or a failure ended 18px under Send (R-184). No Playwright phone
 * draws an inset: the stylesheet is served with each one at an iPhone 13's
 * 34px.
 */
test.describe("with a home indicator", () => {
  /* page.route misses requests the service worker makes in WebKit. */
  test.use({ serviceWorkers: "block" });

  test("what a sheet brings into view ends clear of Send, which rests above the indicator", async ({
    memberPage: page,
  }) => {
    await page.route(/\/_next\/static\/[^?]*\.css(\?|$)/, async (route) => {
      const response = await route.fetch();
      const css = await response.text();
      await route.fulfill({
        status: response.status(),
        contentType: "text/css; charset=utf-8",
        body: css.replaceAll("env(safe-area-inset-bottom)", "34px"),
      });
    });
    await page.goto(`/households/${RESOLVED_HOUSEHOLD}`);
    await atCap(page);
    await page.getByRole("button", { name: SUGGESTING.open, exact: true }).first().click();
    const sheet = page.getByRole("dialog", { name: SUGGESTING.title });
    const due = sheet.getByLabel("Go back by (optional)");
    /* So a pass is not a stylesheet served unchanged. */
    expect(
      await due.evaluate((field) => {
        const body = field.closest("[data-sheet-body]");
        return body === null ? null : getComputedStyle(body).paddingBottom;
      }),
      "the body's padding for the home indicator",
    ).toBe("34px");

    /* Below the note at this size. Scrolled as the sheet scrolls a field
       taking focus, and the amend sheet its failure: focus itself has each
       engine scroll a hidden field toward the middle first, and WebKit did
       so for this date field even with preventScroll. */
    await due.evaluate((field) => {
      field.scrollIntoView({ block: "nearest" });
    });
    await expect
      .poll(
        () =>
          due.evaluate((field) => {
            const bar = field.closest("[data-sheet-body]")?.querySelector("[data-sheet-actions]");
            if (!bar) return null;
            return Math.round(
              bar.getBoundingClientRect().top - field.getBoundingClientRect().bottom,
            );
          }),
        { message: "the room between Go back by and the top of Send's bar" },
      )
      .toBe(16);
  });
});

/* From the default to the cap: the iOS sizes past Large (21px, 23px), and
   either side of where each phone turns compact (about 25px on an iPhone
   13, 27px on a Pixel 5). */
const SIZES = [
  "16px",
  "18px",
  "20px",
  "21px",
  "23px",
  "25px",
  "26px",
  "27px",
  "28px",
  "30px",
  "32px",
];

type ChromeBoxes = {
  nav: number | null;
  bar: number | null;
  row: number | null;
  labels: { label: string; whole: boolean }[];
};

/* The heights of the chrome that stays put - the nav, the docked Save bar
   and the sync row - and whether each nav label is drawn whole in its tab,
   which is at least 44px tall. */
function chromeBoxes(page: Page): Promise<ChromeBoxes> {
  return page.evaluate(() => {
    const height = (element: Element | null) =>
      element === null ? null : Math.round(element.getBoundingClientRect().height);
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const labels = [...(nav?.querySelectorAll("li a") ?? [])].map((link) => {
      const tab = link.getBoundingClientRect();
      const label = link.querySelector("span")?.getBoundingClientRect();
      const whole =
        label !== undefined &&
        label.width > 1 &&
        label.left >= tab.left - 0.5 &&
        label.right <= tab.right + 0.5 &&
        tab.height >= 44;
      return { label: link.textContent.trim(), whole };
    });
    return {
      nav: height(nav),
      bar: height(document.querySelector('[data-dock="nav"]')),
      row: height(document.querySelector("main > :first-child")),
      labels,
    };
  });
}

/*
 * A recording form as it opens, at every size: its unit number in view and
 * uncovered without a scroll, and the chrome that stays put leaving half
 * the screen. That chrome keeps the size it has at the 16px base, as an
 * iPhone's tab bar and toolbars do, with every nav label whole.
 */
async function expectFormOpensInView(
  page: Page,
  what: string,
  also: (size: string) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const unit = page.getByLabel("Unit number");
  await atSize(page, "16px");
  const base = await chromeBoxes(page);
  expect(
    base.labels.every((label) => label.whole),
    `the nav's labels ${what}`,
  ).toBe(true);
  for (const size of SIZES) {
    await atSize(page, size);
    expect(await page.evaluate(() => window.scrollY), `${what}, opened scrolled`).toBe(0);
    await expectInView(unit, `the unit number ${what} at ${size}`);
    expect(await chromeShare(page), `the chrome ${what} at ${size}`).toBeLessThanOrEqual(0.5);
    expect(await chromeBoxes(page), `the chrome's size ${what} at ${size}`).toEqual(base);
    await also(size);
  }
}

test("the recording screen opens with its unit number in view, at every text size", async ({
  memberPage: page,
}) => {
  await page.goto(`/blocks/${SEED_BLOCK}`);
  await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
  const back = page.getByRole("link", { name: "Back to Session" });
  await expectFormOpensInView(page, "with nothing waiting", async (size) => {
    const box = await back.boundingBox();
    expect(box?.width, `the way back at ${size}`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `the way back at ${size}`).toBeGreaterThanOrEqual(44);
  });
});

test.describe("as the session answers", () => {
  /* page.route cannot reach a request the service worker makes. */
  test.use({ serviceWorkers: "block" });

  /*
   * The title is generic until the session answers. Set on two lines at the
   * largest text, it gave one back as "Blk 123" arrived, and the form jumped
   * 48px up under a press already on its way: on CI's Linux WebKit, Add
   * details was pressed and never opened (#181). 320px wide, the generic
   * title wraps in every engine's font, as it did 390px wide in CI's.
   *
   * In a follow-up session the screen then says what the session allows,
   * and drawn above the form that dropped the unit field 170px (#200). The
   * unit's history lands later still, and above the interest level it pushed
   * the picker down under a thumb (#196).
   *
   * So the history is last in the form, and on an iPhone at the default
   * text that left all of it below Save: an overdue note went unseen before
   * the knock. The line under the unit field says what it holds, held at
   * the room it can take from the render the unit matches one of the block's.
   */
  test("the recording form holds still as the block's name arrives", async ({
    memberPage: page,
    adminApi,
  }) => {
    /* Each answer waits for the test: a route that let one through lets
       every later one through too. */
    const holdBack = async (url: string): Promise<() => void> => {
      await page.unroute(url);
      const held = Promise.withResolvers<undefined>();
      await page.route(url, async (route) => {
        await held.promise;
        await route.continue();
      });
      return () => {
        held.resolve(undefined);
      };
    };
    const line = page.locator("#unit-history");
    const seeHistory = line.getByRole("button", { name: "See history" });
    const unit = page.getByLabel("Unit number");
    const picker = page.getByRole("radiogroup", { name: "Interest level" });
    /* Measured from the unit field, so a Saved line above it, or a scroll,
       does not count as the picker moving. */
    const pickerBelowUnit = async () => {
      const [field, group] = await Promise.all([unit.boundingBox(), picker.boundingBox()]);
      if (field === null || group === null) throw new Error("No unit field or interest level");
      return group.y - field.y;
    };

    /* A door-to-door session at the phone's own width: at the default sizes
       the line is read before knocking, above the docked Save, unscrolled.
       16px, and 17px, an iPhone's default. */
    await listSeededHousehold(adminApi);
    for (const size of ["16px", "17px", CAP]) {
      const history = await holdBack("**/api/households/*");
      await page.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(LISTED_UNIT)}`);
      await atSize(page, size);
      await untilLive(page);
      await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
      await expect(line).toHaveText("Checking this unit's history…");
      const tapped = [
        line,
        page.getByRole("radio", { name: "Medium" }),
        page.getByRole("button", { name: "Add details" }),
      ];
      const boxes = await Promise.all(tapped.map((target) => target.boundingBox()));
      expect(boxes, `the line, Medium and Add details at ${size}`).not.toContain(null);
      history();
      /* Overdue unless an earlier spec has done the seed's note. */
      await expect(line).toHaveText(
        /^On the follow-up list · (Overdue · )?\d+ visits? · See history$/,
      );
      expect(
        await Promise.all(tapped.map((target) => target.boundingBox())),
        `the line, Medium and Add details as the unit's history lands at ${size}`,
      ).toEqual(boxes);
      expect((await seeHistory.boundingBox())?.height, `See history's target at ${size}`).toBe(
        Math.max(44, parseFloat(size) * 1.5),
      );
      if (size !== CAP) {
        expect(await page.evaluate(() => window.scrollY), `scrolled at ${size}`).toBe(0);
        await expectInView(line, `the unit's history line at ${size}`);
        /* Held a row taller than its words, it took the picker under Save
           at 17px on an iPhone. */
        expect((await line.boundingBox())?.height, `the unit's history line at ${size}`).toBe(44);
        for (const level of ["Low", "Medium", "High"]) {
          await expectInView(page.getByRole("radio", { name: level }), `${level} at ${size}`);
        }

        /* A unit with no history to read has no line and keeps no room
           for one (owner, 2026-11-18): a row at every new door put Low,
           Medium and High under Save after Save and next on an iPhone at
           17px. #87-99 is never recorded, and #87-02 only ever guessed. */
        await unit.fill("");
        await expect(line).toHaveCount(0);
        const empty = await pickerBelowUnit();
        await unit.fill("#87-99");
        expect(await pickerBelowUnit(), `the interest level, a new unit typed, at ${size}`).toBe(
          empty,
        );
        await expect(line).toHaveCount(0);
        await unit.fill("#87-01");
        await page.getByRole("radio", { name: "No response" }).click();
        await page.getByRole("button", { name: "Save and next" }).click();
        await expect(unit).toHaveValue("#87-02");
        expect(
          await pickerBelowUnit(),
          `the interest level, after Save and next onto a new unit, at ${size}`,
        ).toBe(empty);
        await expect(line).toHaveCount(0);
      }
    }

    let answer = await holdBack("**/api/sessions/active");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/blocks/${SEED_BLOCK}`);
    await atCap(page);
    await untilLive(page);
    const before = await unit.boundingBox();
    answer();
    await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    expect(await unit.boundingBox(), "the unit field as the name arrives").toEqual(before);

    await startFollowUpSession(adminApi);
    try {
      answer = await holdBack("**/api/sessions/active");
      const history = await holdBack("**/api/households/*");
      await page.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(LISTED_UNIT)}`);
      await atCap(page);
      await untilLive(page);
      const opened = await unit.boundingBox();
      expect(opened, "the unit field as the screen opens").not.toBeNull();
      answer();
      await expect(page.getByText(/You can record any unit in this block/)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
      expect(await unit.boundingBox(), "the unit field as a follow-up session answers").toEqual(
        opened,
      );

      await expect(page.getByRole("list", { name: "On the list in this block" })).toBeVisible();
      await expect(line).toHaveText("Checking this unit's history…");
      const tapped = [
        line,
        page.getByRole("radio", { name: "Medium" }),
        page.getByRole("button", { name: "Add details" }),
      ];
      const boxes = await Promise.all(tapped.map((target) => target.boundingBox()));
      expect(boxes, "the line, Medium and Add details before the unit's history").not.toContain(
        null,
      );
      history();
      await expect(
        page.getByRole("region", { name: "What we know about this unit" }),
      ).toBeVisible();
      await expect(seeHistory).toBeVisible();
      expect(
        await Promise.all(tapped.map((target) => target.boundingBox())),
        "the line, Medium and Add details as the unit's history lands",
      ).toEqual(boxes);
    } finally {
      await endActiveSession(adminApi);
    }
  });
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

  test("with records waiting, the recording screen opens with its unit number in view, under the pinned count", async ({
    memberPage: page,
  }) => {
    await page.route("**/api/visits/sync", (route) => route.abort("internetdisconnected"));
    await page.goto(`/blocks/${SEED_BLOCK}`);
    await untilLive(page);
    for (const unit of ["#88-01", "#88-02"]) {
      await page.getByLabel("Unit number").fill(unit);
      await page.getByRole("radio", { name: "High" }).click();
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(page.getByRole("status")).toContainText(`Saved ${unit} on this phone`);
    }
    const bar = page.getByRole("button", { name: /2 waiting to send/ });
    await expect(bar).toBeVisible();

    /* Opened again with them waiting, as the next block is. */
    await page.goto(`/blocks/${SEED_BLOCK}`);
    await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    await expect(bar).toBeVisible();
    await expectFormOpensInView(page, "with records waiting", async (size) => {
      await expectWhole(bar.getByText("2 waiting to send"), `the count at ${size}`);
    });

    /* Scrolled to the end: the count stays pinned at the top while anything
       is unsent (D-33-12), and with the rest leaves half the screen. */
    const scrolled = async (screen: string) => {
      await atCap(page);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await expect.poll(() => screenFaults(page), { message: screen }).toEqual([]);
      await expectWhole(bar.getByText("2 waiting to send"), `the count on ${screen}`);
    };
    await scrolled("recording, with records waiting");
    expect(
      await page.evaluate(() => window.scrollY),
      "the form is long enough to scroll",
    ).toBeGreaterThan(0);
    expect(Math.abs((await bar.boundingBox())?.y ?? 99), "the count pinned on top").toBeLessThan(1);
    await page.goto("/");
    await scrolled("Session, with records waiting");
  });

  /*
   * At large text High is below Save, so the member scrolls down to it. The
   * Saved line and the next unit, already filled in, were then left above
   * the screen, and a second tap recorded that unit unseen. After a save
   * both are back in view, under the pinned count. At the base size, where
   * nothing was scrolled, nothing moves.
   */
  test("after Save and next, the Saved line and the next unit are in view", async ({
    memberPage: page,
  }) => {
    await page.route("**/api/visits/sync", (route) => route.abort("internetdisconnected"));
    await page.goto(`/blocks/${SEED_BLOCK}`);
    await untilLive(page);
    const unit = page.getByLabel("Unit number");
    const high = page.getByRole("radio", { name: "High" });
    const status = page.getByRole("status");
    const save = async (number: string) => {
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(status).toContainText(`Saved ${number} on this phone`);
    };

    await atSize(page, "16px");
    await unit.fill("#86-01");
    await high.click();
    const before = await page.evaluate(() => window.scrollY);
    await save("#86-01");
    expect(await page.evaluate(() => window.scrollY), "the base size, after a save").toBe(before);

    for (const [size, number] of [
      ["28px", "#86-02"],
      [CAP, "#86-03"],
    ] as const) {
      await atSize(page, size);
      await unit.fill(number);
      /* As a thumb does: scrolled to mid-screen, then tapped. */
      await high.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
      });
      await high.click();
      await save(number);
      await expectInView(status, `the Saved line after a save at ${size}`);
      await expectInView(unit, `the next unit after a save at ${size}`);
    }

    /*
     * Then signal comes back with a save, and the line offers a suggestion
     * once the server has the visit. Beside the words, at the cap it was
     * pushed onto a row of its own as it turned up, and the next unit
     * dropped 48px under a thumb about to type it (#196). Its row is held
     * from the save on. At the base size, on a phone as narrow as 360px,
     * these words and the offer still share a row, so the line stays one
     * row with nothing held, as it always was. Each send waits for the test,
     * so the field is measured while it is still on its way.
     *
     * Only the batch with this unit is held. The queue's own retry of the
     * earlier saves can go out first, and held, it would keep this save
     * from ever being sent.
     */
    const holdSend = async (number: string): Promise<() => void> => {
      await page.unroute("**/api/visits/sync");
      const sent = Promise.withResolvers<undefined>();
      await page.route("**/api/visits/sync", async (route) => {
        const { items } = route.request().postDataJSON() as VisitSyncRequest;
        if (items.some((item) => item.unitNumber === number)) await sent.promise;
        await route.continue();
      });
      return () => {
        sent.resolve(undefined);
      };
    };
    /* 0 while the line is one row: no taller than its least height. */
    const pastOneRow = () =>
      status.evaluate(
        (line) =>
          line.getBoundingClientRect().height - parseFloat(getComputedStyle(line).minHeight),
      );
    const phone = page.viewportSize();
    if (phone === null) throw new Error("The phone project sets no viewport");
    for (const [size, number] of [
      ["16px", "#86-04"],
      [CAP, "#86-05"],
    ] as const) {
      const base = size === "16px";
      await page.setViewportSize(base ? { width: 360, height: phone.height } : phone);
      await atSize(page, size);
      const send = await holdSend(number);
      await unit.fill(number);
      if (!base) {
        await high.evaluate((element) => {
          element.scrollIntoView({ block: "center" });
        });
      }
      await high.click();
      await page.getByRole("button", { name: "Save and next" }).click();
      const sending = status.filter({ hasText: `Sending ${number}` });
      await expect(sending).toBeVisible();
      const whileSending = await unit.boundingBox();
      expect(whileSending, `the next unit while sending at ${size}`).not.toBeNull();
      if (base) expect(await pastOneRow(), "the Saved line while sending at 16px").toBe(0);
      await expect(sending).toBeVisible();
      send();
      await expect(
        status
          .filter({ hasText: `Saved ${number}.` })
          .getByRole("button", { name: "Suggest a return visit" }),
      ).toBeVisible();
      if (base) expect(await pastOneRow(), "the suggestion beside the words at 16px").toBe(0);
      expect(
        await unit.boundingBox(),
        `the next unit as the suggestion is offered at ${size}`,
      ).toEqual(whileSending);
    }
  });

  test("the offline shell's recording form opens with its unit number in view, at every text size", async ({
    memberPage: page,
  }) => {
    /* Home keeps the session on the phone, and the block screen its block. */
    await page.goto("/");
    await page.getByRole("link", { name: /Blk 123/ }).click();
    await expect.poll(() => blocksOnPhone(page)).toContain(SEED_BLOCK);

    /* As after a cold reload in a dead spot. */
    await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
    await page.goto("/offline");
    await page.getByRole("button", { name: /^Continue as / }).click();
    const open = async () => {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.getByRole("button", { name: /^Blk 123/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Blk 123" })).toBeVisible();
    };
    await open();
    await expectFormOpensInView(page, "offline");

    /* Then with records waiting: two saved here, and the block opened again. */
    await atSize(page, "16px");
    for (const unit of ["#89-01", "#89-02"]) {
      await page.getByLabel("Unit number").fill(unit);
      await page.getByRole("radio", { name: "High" }).click();
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(page.getByRole("status")).toContainText(`Saved ${unit} on this phone`);
    }
    await page.getByRole("button", { name: "All blocks" }).click();
    await open();
    await expect(page.getByRole("button", { name: /2 waiting to send/ })).toBeVisible();
    await expectFormOpensInView(page, "offline, with records waiting");
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

/*
 * A follow-up session's own screens: the member's list of households, the
 * recording form with its chips and its refusal, and the admin's panel. Its
 * session is ended afterwards, so no other spec records into it.
 */
test.describe("a follow-up session", () => {
  test.beforeEach(async ({ adminApi }) => {
    await startFollowUpSession(adminApi, "Follow-up visits, Saturday");
  });

  test.afterEach(async ({ adminApi }) => {
    await endActiveSession(adminApi);
  });

  /* As a thumb does: down to the interest level. The door's history lands
     after it, at the end of the form, so a tap made as it lands meets what
     it aimed at (#196). */
  async function pickMedium(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const medium = page.getByRole("radio", { name: "Medium" });
    await medium.click();
    await expect(medium).toBeChecked();
  }

  test("its screens fit at the largest text", async ({ memberPage, adminPage, adminApi }) => {
    await memberPage.goto("/");
    await atCap(memberPage);
    const row = memberPage.locator('main a[href*="?unit="]').first();
    await expectFits(memberPage, "a follow-up session", row);
    await expectFits(
      memberPage,
      "marking a household done",
      memberPage.getByRole("button", { name: "Mark done" }).first(),
    );

    await row.click();
    await memberPage.waitForURL(/\/blocks\/.*\?unit=/);
    await atCap(memberPage);
    await untilLive(memberPage);
    const chip = memberPage
      .getByRole("list", { name: "On the list in this block" })
      .getByRole("button")
      .first();
    /* Where it opened, unscrolled, once the session has answered: the line
       saying what the session allows comes with the answer, and drawn above
       the form it left the field half under the docked Save (#200). Before
       expectFits, which scrolls. */
    await expect(chip).toBeVisible();
    await expectInView(
      memberPage.getByLabel("Unit number"),
      "the unit field once the session has answered",
    );
    await expectFits(memberPage, "the follow-up list's units", chip);
    await memberPage.getByLabel("Unit number").fill("#09-999");
    await expectFits(
      memberPage,
      "a unit off the follow-up list",
      memberPage.getByLabel("Unit number"),
    );
    await expectTappable(memberPage.getByRole("button", { name: "Save", exact: true }), "Save");

    const { session } = (await (await adminApi.get("/api/sessions/active")).json()) as {
      session: { id: string };
    };
    await adminPage.goto(`/admin/sessions/${session.id}`);
    await atCap(adminPage);
    await expectFits(
      adminPage,
      "a follow-up session's households",
      adminPage.getByRole("heading", { name: /^Households to revisit/ }),
    );
    /* Its blocks follow its households: nothing to add or take away by hand. */
    await expect(adminPage.getByRole("button", { name: "Add blocks" })).toHaveCount(0);
    await adminPage.getByRole("button", { name: "Add households" }).click();
    const adding = adminPage.getByRole("dialog", { name: "Add households" });
    await expect(adding.getByRole("button", { name: /^Add \d+ household/ })).toBeVisible();
    await expectFits(adminPage, "adding households", adding);
    /* A box taking focus brings its whole tile clear of the bar holding
       Add: the box alone left the tile running about 64px under it (#196).
       Read from the boxes: the list's rounded corners clip the tile's own,
       so a tap there finds the sheet. */
    const box = adding.getByRole("checkbox").last();
    await box.focus();
    await expect
      .poll(
        () =>
          box.evaluate((input) => {
            const body = input.closest("[data-sheet-body]");
            const tile = input.closest("label")?.getBoundingClientRect();
            const bar = body?.lastElementChild?.getBoundingClientRect();
            const top = body?.getBoundingClientRect().top;
            if (tile === undefined || bar === undefined || top === undefined) return "no tile";
            if (tile.top < top) return "its top cut off";
            const under = Math.round(tile.bottom - bar.top);
            return under > 0 ? `its foot ${String(under)}px under the bar` : "in view";
          }),
        { message: "a household's tile once its box has focus" },
      )
      .toBe("in view");
    await adminPage.keyboard.press("Escape");

    /* Recorded for a member at a door on the list, the line saying it was
       marked done is in view with its Undo as the sheet goes, unscrolled and
       clear of the nav, where it had landed under it (#196). Undo leaves the
       note owed, as it was. */
    await adminPage.goto("/admin/records");
    await atCap(adminPage);
    await adminPage.getByRole("button", { name: "Record for a member" }).click();
    const record = adminPage.getByRole("dialog", { name: "Record on behalf of a member" });
    await record.getByLabel("Recorded by").selectOption(SEED_MEMBER_ID);
    await record.getByLabel("Block").selectOption(SEED_BLOCK);
    await record.getByLabel("Unit number").fill(LISTED_UNIT);
    await record.getByRole("radio", { name: "Medium" }).click();
    await record.getByRole("button", { name: "Save the record" }).click();
    const marked = adminPage.getByRole("status").filter({ hasText: `Saved ${LISTED_UNIT} for` });
    const undo = marked.getByRole("button", { name: /^Undo/ });
    await expectInView(marked, "the line saying what a record for a member marked done");
    await expectInView(undo, "Undo on that line");
    await undo.click();
    await expect(marked).toContainText("Undone.");
  });

  /*
   * After a save among a dozen listed doors, the line says what the save
   * marked, with Undo and Back to the list, above the next unit. On an
   * iPhone 13 at the cap the follow-up row beside Undo was set a word a
   * line, about 330px tall, "Follow-up" broke at its hyphen, and the unit
   * field went half under the docked Save; on a 320x568 screen Back to the
   * list did too (#136).
   */
  test("after a save among a dozen listed doors, the next unit and the way back are clear of Save", async ({
    memberPage: page,
    adminApi,
  }, testInfo) => {
    const { session } = (await (await adminApi.get("/api/sessions/active")).json()) as {
      session: { id: string };
    };
    /* Eleven doors of this test's own besides the seeded one, so the chips
       run to several rows and the form scrolls. */
    const stamp = String(Date.now()).slice(-2);
    const floor = `#7${String(testInfo.project.name.length % 10)}`;
    const unitOf = (door: number) => `${floor}-${String(door).padStart(2, "0")}${stamp}`;
    const notes: string[] = [];
    try {
      /* One batch, not eleven direct saves: those spent over a third of the
         admin's per-minute budget, so a repeat of this test was refused 429. */
      const now = new Date().toISOString();
      const batch: VisitSyncRequest = {
        sentAt: now,
        items: Array.from({ length: 11 }, (_, index) => ({
          id: uuidv7(),
          blockId: SEED_BLOCK,
          unitNumber: unitOf(index + 1),
          sessionId: session.id,
          interestLevel: "medium",
          clientCreatedAt: now,
          updatedAt: now,
        })),
      };
      const synced = await adminApi.post("/api/visits/sync", { data: batch });
      expect(synced.status()).toBe(200);
      const { results } = (await synced.json()) as VisitSyncResponse;
      expect(results.map((result) => result.status)).toEqual(batch.items.map(() => "applied"));
      const doors = results.flatMap((result) => (result.visit ? [result.visit.householdId] : []));
      for (const householdId of doors) {
        const listed = await adminApi.post("/api/follow-ups", {
          data: { householdId, note: "Bring the pamphlet" },
        });
        expect(listed.status()).toBe(201);
        notes.push(((await listed.json()) as { id: string }).id);
      }
      const picked = await adminApi.post(`/api/sessions/${session.id}/households`, {
        data: { householdIds: doors },
      });
      expect(picked.status()).toBe(200);

      await page.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(LISTED_UNIT)}`);
      await untilLive(page);
      const chips = page.getByRole("list", { name: "On the list in this block" });
      await expect(chips.getByRole("listitem")).toHaveCount(12);
      const unit = page.getByLabel("Unit number");
      const back = page.getByRole("main").getByRole("link", { name: "Back to the list" });

      /* Then Save, with signal. */
      const saveAt = async (size: string, door: string) => {
        await atSize(page, size);
        if (door !== LISTED_UNIT) await chips.getByRole("button", { name: door }).click();
        await expect(unit).toHaveValue(door);
        await pickMedium(page);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        const status = page.getByRole("status").filter({ hasText: `Saved ${door}.` });
        await expect(status).toContainText("Follow-up marked done.");
        return status;
      };

      const status = await saveAt(CAP, LISTED_UNIT);
      await expectInView(status.getByRole("button", { name: /^Undo/ }), "Undo after a save");
      await expectInView(back, "Back to the list after a save");
      await expectInView(unit, "the next unit after a save");
      await expect.poll(() => screenFaults(page), { message: "the Saved line" }).toEqual([]);
      await expectOnOneLine(
        status.getByText("Follow-up", { exact: true }),
        "Follow-up in the Saved line",
      );

      /* The smallest phone screen: there the line and the next unit cannot
         both fit at the cap, but the way back to the list always does. */
      await page.setViewportSize({ width: 320, height: 568 });
      for (const [size, door] of [
        [CAP, unitOf(1)],
        ["16px", unitOf(2)],
      ] as const) {
        await saveAt(size, door);
        await expectInView(back, `Back to the list at 320x568 and ${size}`);
      }
      await expectInView(unit, "the next unit at 320x568 and 16px");
    } finally {
      /* Left as it found the list. */
      for (const id of notes) {
        const removed = await adminApi.post(`/api/follow-ups/${id}/remove`, {
          data: { reason: "Test done" },
        });
        expect(removed.status()).toBe(204);
      }
    }
  });

  test.describe("without signal", () => {
    /* page.route cannot reach a request the service worker makes. */
    test.use({ serviceWorkers: "block" });

    /*
     * "Saved … on this phone." is longer than "Sending …", and at the cap it
     * wrapped a row taller just after Save, so the unit field dropped 48px
     * under a thumb about to type the next door (#136).
     */
    test("the next unit holds still from Sending to Saved on this phone", async ({
      memberPage: page,
    }) => {
      await page.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(LISTED_UNIT)}`);
      await untilLive(page);
      await atCap(page);
      /* Weak signal: the first send hangs until the test lets it go, then
         every one fails. */
      const held = Promise.withResolvers<undefined>();
      let attempts = 0;
      await page.route("**/api/visits/sync", async (route) => {
        attempts += 1;
        if (attempts === 1) await held.promise;
        await route.abort("internetdisconnected");
      });
      await pickMedium(page);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const unit = page.getByLabel("Unit number");
      const sendingLine = page.getByRole("status").filter({ hasText: `Sending ${LISTED_UNIT}` });
      await expect(sendingLine).toBeVisible();
      const sending = await unit.boundingBox();
      expect(sending, "the next unit while sending").not.toBeNull();
      /* Measured while sending: the line cannot move on before the release,
         short of the client's own 20s give-up. */
      await expect(sendingLine).toBeVisible();
      held.resolve(undefined);
      await expect(
        page.getByRole("status").filter({ hasText: `Saved ${LISTED_UNIT} on this phone.` }),
      ).toBeVisible();
      const saved = await unit.boundingBox();
      expect(saved, "the next unit, once saved on the phone").not.toBeNull();
      expect(saved?.y, "the next unit, once saved on the phone").toBe(sending?.y);
      await expectInView(unit, "the next unit, once saved on the phone");
    });
  });
});
