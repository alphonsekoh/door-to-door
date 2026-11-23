import type { Locator } from "@playwright/test";
import { uuidv7 } from "../src/lib/uuid";
import { SEED_BLOCK } from "./accounts";
import {
  endActiveSession,
  expect,
  listSeededHousehold,
  startFollowUpSession,
  test,
  untilLive,
} from "./fixtures";

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

/* Where the page opens, before any scroll, and what a tap there lands on. */
async function expectInViewOnArrival(target: Locator): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight) return false;
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== null && (element.contains(top) || top.contains(element));
      }),
    )
    .toBe(true);
}

/* Where the page says what it holds, in its tab as the fixtures keep theirs. */
const HELD = "e2e:held-answers";

/*
 * Runs in the page. WebKit can run an answer's code inside the input event
 * of text landing in the unit field, after the field has changed and before
 * React has read it, and an answer set then put the old unit back (#155).
 * This makes it happen every time rather than now and then: on a block
 * screen the answers about the session and the block's units are held once
 * they arrive, and the first input to the unit field lets them go from a
 * window capture listener, which runs before React's. Each is read in full
 * first, so all of its code runs inside that event.
 */
function holdFirstAnswers(key: string): void {
  const held: (() => void)[] = [];
  const names = new Set<string>();
  const say = (state: "held" | "released"): void => {
    sessionStorage.setItem(key, `${state} ${[...names].sort().join(", ")}`);
  };
  const released = (): boolean => sessionStorage.getItem(key)?.startsWith("released") === true;
  const send = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const onBlock = location.pathname.startsWith("/blocks/");
    const response = await send(input, init);
    const { pathname } = new URL(input instanceof Request ? input.url : input, location.href);
    const name =
      pathname === "/api/sessions/active"
        ? "session"
        : pathname === "/api/households"
          ? "units"
          : null;
    if (!onBlock || name === null || !response.ok) return response;
    const body: unknown = await response.clone().json();
    if (released()) return response;
    Object.defineProperty(response, "json", { value: () => Promise.resolve(body) });
    names.add(name);
    say("held");
    return new Promise<Response>((resolve) => {
      held.push(() => {
        resolve(response);
      });
    });
  };
  addEventListener(
    "input",
    (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.id !== "unitNumber") return;
      if (released()) return;
      say("released");
      for (const answer of held.splice(0)) answer();
    },
    true,
  );
}

test.afterEach(async ({ adminApi }) => {
  await endActiveSession(adminApi);
});

test("a member records a unit off the list, and a listed one marks its follow-up done", async ({
  memberPage,
  adminApi,
}, testInfo) => {
  /* A door of this test's own, so a rerun never finds it visited already. */
  const OFF_LIST = `#9${String(testInfo.project.name.length % 10)}-${String(Date.now()).slice(-5)}`;
  await startFollowUpSession(adminApi);
  await memberPage.addInitScript(holdFirstAnswers, HELD);

  await memberPage.goto("/");
  await expect(
    memberPage.getByText("Tap a household to record your visit.", { exact: true }),
  ).toBeVisible();
  await expect(
    memberPage.getByText(
      "Visit the households below; other units in their blocks can be recorded too.",
    ),
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

  /* Typed as the screen's first answers land, inside the same input event,
     the new unit is kept (#155). */
  const held = () => memberPage.evaluate((key) => sessionStorage.getItem(key), HELD);
  await expect.poll(held).toBe("held session, units");
  await unit.fill(OFF_LIST);
  expect(await held(), "the answers landed inside the fill").toBe("released session, units");
  await expect(unit).toHaveValue(OFF_LIST);

  /* A unit off the list is explained, and saved all the same: a one-off
     visit with no follow-up to mark, which Suggest can follow. */
  await expect(
    memberPage.getByText("Not on this session's list. You can still record it."),
  ).toBeVisible();
  await memberPage.getByRole("radio", { name: "High" }).click();
  const save = memberPage.getByRole("button", { name: "Save", exact: true });
  await expectTappable(save);
  await save.click();
  const oneOff = memberPage.getByRole("status").filter({ hasText: `Saved ${OFF_LIST}` });
  await expect(oneOff).toBeVisible();
  await expect(oneOff).not.toContainText("Follow-up marked done");
  await expect(oneOff.getByRole("button", { name: "Suggest a return visit" })).toBeVisible();
  await expect(memberPage.getByRole("alert").filter({ hasText: "Not saved" })).toHaveCount(0);

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

  /* Saving marked its follow-up done, once sent; Undo reopens it, and the
     list then reads the household as visited, still counted. */
  await expect(status).toContainText("Follow-up marked done.");
  const undo = status.getByRole("button", { name: "Undo marking the follow-up done" });
  const target = await undo.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width, "a word this short needs its own minimum width").toBeGreaterThanOrEqual(44);
  await expectTappable(undo);
  await undo.click();
  await expect(status).toContainText("Undone. Follow-up reopened.");
  await status.getByRole("link", { name: "Back to the list" }).click();
  await expect(row).toContainText("Visited");
  await expect(list).toContainText("1 of 1 visited or done");
});

test("an admin picks the households for a follow-up session, and a member is sent to them", async ({
  adminPage,
  memberPage,
  adminApi,
}) => {
  await endActiveSession(adminApi);
  await listSeededHousehold(adminApi);
  const title = `Revisits ${String(Date.now())}`;

  await adminPage.goto("/admin/sessions");
  await adminPage.getByRole("button", { name: "New session" }).click();
  await adminPage.getByRole("radio", { name: /Follow-up/ }).click();
  await adminPage.getByLabel("Name this session").fill(title);

  /* Everything on the follow-up list starts ticked. */
  const picker = adminPage.getByRole("group", { name: "Households to visit" });
  const door = picker.getByRole("checkbox", { name: `Blk 123 · ${LISTED_UNIT}` });
  await expect(door).toBeChecked();
  await expect(picker.getByRole("status")).toContainText(/^(\d+) of \1 household/);

  /* None ticked, Create draft waits and says why. */
  await picker.getByRole("button", { name: "Untick all" }).click();
  const create = adminPage.getByRole("button", { name: "Create draft" });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAccessibleDescription("Tick at least one household to visit.");
  await door.check();

  /* Below a long list, Create draft is still what a tap lands on. */
  await expectTappable(create);
  await create.click();
  const row = adminPage.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Start session" }).click();
  await expect(row).toContainText("Running now");

  await memberPage.goto("/");
  const list = memberPage.getByRole("region", { name: "Households to revisit" });
  await expect(list.locator(`a[href*="?unit=${encodeURIComponent(LISTED_UNIT)}"]`)).toBeVisible();
});

test("a member's suggestion is reviewed by an admin, and the member is told it was declined", async ({
  memberPage,
  adminPage,
  adminApi,
}) => {
  const stamp = String(Date.now());
  const note = `Asked us back after 7pm (${stamp})`;

  /* Earlier removals, so the notice has more than it shows at first. */
  for (const n of [1, 2, 3, 4]) {
    const suggested = await memberPage.request.post("/api/follow-ups", {
      data: { householdId: QUIET_HOUSEHOLD, note: `Earlier suggestion ${String(n)} (${stamp})` },
    });
    expect(suggested.status()).toBe(201);
    const { id } = (await suggested.json()) as { id: string };
    const removed = await adminApi.post(`/api/follow-ups/${id}/remove`, {
      data: { reason: "Visited already" },
    });
    expect(removed.status()).toBe(204);
  }

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
  const confirm = dismiss.getByRole("button", { name: "Dismiss suggestion" });

  /* With the keyboard up, which a short viewport stands in for, the reason
     being typed stays clear of the docked bar. */
  const phone = adminPage.viewportSize();
  if (phone === null) throw new Error("expected a phone viewport");
  await adminPage.setViewportSize({ width: phone.width, height: 400 });
  const reason = dismiss.getByLabel("Why not add it?");
  await reason.fill("Visited last week\nNobody home twice since");
  await expect
    .poll(async () => {
      const field = await reason.boundingBox();
      const bar = await confirm.locator("..").boundingBox();
      return field !== null && bar !== null && field.y + field.height <= bar.y + 0.5;
    })
    .toBe(true);
  await adminPage.setViewportSize(phone);
  await reason.fill("Visited last week");

  await expectTappable(confirm);
  await confirm.click();
  await expect(item).toBeHidden();

  await memberPage.goto("/follow-ups");
  const declined = memberPage.getByRole("region", { name: "Not on the follow-up list" });
  /* How many there are, and Got it to all, are in view where the page opens,
     not under the bottom nav below three notes. */
  const showAll = declined.getByRole("button", { name: /^Show all \(\d+\)$/ });
  await expectInViewOnArrival(showAll);
  await expectInViewOnArrival(declined.getByRole("button", { name: "Got it to all" }));

  const entry = declined.getByRole("listitem").filter({ hasText: note });
  await expect(entry).toContainText(/Declined by Admin User · .+: Visited last week/);
  await entry.getByRole("button", { name: "Got it" }).click();
  await expect(entry).toBeHidden();

  const left = Number(/\((\d+)\)/.exec((await showAll.textContent()) ?? "")?.[1]);
  await showAll.click();
  await expect(declined.getByRole("listitem")).toHaveCount(left);
  await expect(
    declined.getByRole("listitem").filter({ hasText: `Earlier suggestion 1 (${stamp})` }),
  ).toBeVisible();
  await declined.getByRole("button", { name: "Got it to all" }).click();
  await expect(declined).toBeHidden();
});

test.describe("without signal", () => {
  /* page.route cannot reach a request the service worker makes. */
  test.use({ serviceWorkers: "block" });

  /*
   * "Sending…" fitted beside Back to the list and "Saved … on this phone."
   * did not, so the line grew a row just after Save had scrolled it into
   * view, and the browser kept the unit field still by scrolling the line
   * up under the pinned count. And with a dozen doors on the list in the
   * block, the line, the unit field and the chips together were taller than
   * the screen, so bringing them into view aligned the chips' bottom and
   * left the line above it.
   */
  test("a visit saved on the phone keeps its Saved line clear of the pinned count", async ({
    memberPage,
    adminApi,
  }, testInfo) => {
    const session = await startFollowUpSession(adminApi);

    /* Eleven doors of this test's own besides the seeded one, so the chips
       run to several rows and the form scrolls. */
    const stamp = String(Date.now()).slice(-4);
    const floor = `#4${String(testInfo.project.name.length % 10)}`;
    const notes: string[] = [];
    const doors: string[] = [];
    for (let door = 1; door <= 11; door += 1) {
      const visited = await adminApi.post("/api/visits", {
        data: {
          id: uuidv7(),
          blockId: SEED_BLOCK,
          unitNumber: `${floor}-${String(door).padStart(2, "0")}${stamp}`,
          interestLevel: "medium",
        },
      });
      expect(visited.status()).toBe(201);
      const { householdId } = (await visited.json()) as { householdId: string };
      const listed = await adminApi.post("/api/follow-ups", {
        data: { householdId, note: "Bring the pamphlet" },
      });
      expect(listed.status()).toBe(201);
      notes.push(((await listed.json()) as { id: string }).id);
      doors.push(householdId);
    }
    const picked = await adminApi.post(`/api/sessions/${session}/households`, {
      data: { householdIds: doors },
    });
    expect(picked.status()).toBe(200);

    await memberPage.goto(`/blocks/${SEED_BLOCK}?unit=${encodeURIComponent(LISTED_UNIT)}`);
    await untilLive(memberPage);
    await expect(memberPage.getByLabel("Unit number")).toHaveValue(LISTED_UNIT);
    await expect(
      memberPage.getByRole("list", { name: "On the list in this block" }).getByRole("listitem"),
    ).toHaveCount(12);

    /* Weak signal: the first send hangs a moment, then every one fails. */
    let attempts = 0;
    await memberPage.route("**/api/visits/sync", async (route) => {
      attempts += 1;
      if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.abort("internetdisconnected");
    });

    /* As a thumb does: down to the interest level, once the door's history
       has loaded, then Save. */
    await expect
      .poll(() =>
        memberPage.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return window.scrollY;
        }),
      )
      .toBeGreaterThan(300);
    await memberPage.getByRole("radio", { name: "Medium" }).click();
    await memberPage.getByRole("button", { name: "Save", exact: true }).click();
    const sending = memberPage.getByRole("status").filter({ hasText: `Sending ${LISTED_UNIT}` });
    await expect(sending).toBeVisible();
    const height = (await sending.boundingBox())?.height;
    const status = memberPage
      .getByRole("status")
      .filter({ hasText: `Saved ${LISTED_UNIT} on this phone.` });
    await expect(status).toBeVisible();
    await expect(memberPage.getByRole("button", { name: /1 waiting to send/ })).toBeVisible();
    expect((await status.boundingBox())?.height, "the line's height once saved").toBe(height);
    await expect
      .poll(() =>
        status.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + 2);
          return box.top >= 0 && top !== null && element.contains(top);
        }),
      )
      .toBe(true);

    /* Left as it found the list. */
    for (const id of notes) {
      const removed = await adminApi.post(`/api/follow-ups/${id}/remove`, {
        data: { reason: "Test done" },
      });
      expect(removed.status()).toBe(204);
    }
  });
});
