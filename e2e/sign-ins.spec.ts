import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import { SEED_MEMBER } from "./accounts";
import { ensureActiveSession, expect, signInThroughForm, test, untilLive } from "./fixtures";

/*
 * Sign-ins that can be ended (#125): an admin ends one of a member's, or all
 * of them, and a sign-out leaves nothing a late answer can bring back
 * (#162). Every sign-in ended here is the test's own, on an account it made,
 * or one it signed in through the form: never the saved ones the other
 * specs run on.
 */

const PASSWORD = "password123";
const SESSION_COOKIE = "authjs.session-token";

/* The second phone, told apart from the first on the admin's list. */
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";

type Member = { id: string; email: string; name: string };

async function freshMember(api: APIRequestContext, label: string): Promise<Member> {
  const suffix = `${label}-${String(Date.now())}`;
  const name = `Sign-ins ${suffix}`;
  const created = await api.post("/api/users", {
    data: { email: `sign-ins-${suffix}@example.com`, name, password: PASSWORD },
  });
  expect(created.status()).toBe(201);
  const { id, email } = (await created.json()) as { id: string; email: string };
  return { id, email, name };
}

async function phone(browser: Browser, email: string, userAgent?: string) {
  const context = await browser.newContext(userAgent === undefined ? {} : { userAgent });
  const page = await context.newPage();
  await signInThroughForm(page, email, PASSWORD);
  return { page, close: () => context.close() };
}

/* In view and what a tap lands on, not the bottom nav (as record-visit.spec).
   The page behind a dialog is inert, which hit testing skips, so a nav
   painted over it would go unseen: the check lifts inert while it looks. */
async function expectTappable(target: Locator): Promise<void> {
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

const signedOut = (page: Page) => page.getByRole("heading", { level: 1, name: "Signed out" });

test("an admin signs one of a member's phones out, and the other carries on", async ({
  adminPage,
  adminApi,
  browser,
  browserName,
}) => {
  const member = await freshMember(adminApi, browserName);
  const first = await phone(browser, member.email);
  const second = await phone(browser, member.email, SAMSUNG);
  try {
    await adminPage.goto("/admin/team");
    await adminPage.getByRole("link", { name: `Sign-ins for ${member.name}` }).click();
    await expect(adminPage.getByRole("heading", { level: 1, name: member.name })).toBeVisible();
    await expect(adminPage.getByText("Samsung Internet on Android")).toBeVisible();

    await adminPage.getByRole("button", { name: /^Sign out Samsung Internet on Android/ }).click();
    await expect(adminPage.getByText("Samsung Internet on Android")).toBeHidden();

    // That phone is signed out at its next screen; the other goes on.
    await second.page.goto("/history");
    await expect(signedOut(second.page)).toBeVisible();
    expect((await first.page.request.get("/api/users/me")).status()).toBe(200);
    await first.page.goto("/history");
    await expect(first.page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();

    // Everywhere asks first, with its answer above the bottom nav.
    await adminPage.getByRole("button", { name: "Sign out everywhere" }).click();
    const confirm = adminPage
      .getByRole("alertdialog", { name: `Sign ${member.name} out everywhere?` })
      .getByRole("button", { name: "Sign out everywhere" });
    await expectTappable(confirm);
    await confirm.click();
    await expect(adminPage.getByText("Not signed in anywhere.")).toBeVisible();

    await first.page.reload();
    await expect(signedOut(first.page)).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

/* Every record in the queue on this phone, whoever saved it. */
function queuedRecords(page: Page): Promise<{ unit: string; state: string }[]> {
  return page.evaluate(
    () =>
      new Promise<{ unit: string; state: string }[]>((resolve) => {
        const open = indexedDB.open("door-to-door");
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("visits").objectStore("visits").getAll();
          all.onsuccess = () => {
            const rows = all.result as { state: string; item: { unitNumber: string } }[];
            db.close();
            resolve(rows.map((row) => ({ unit: row.item.unitNumber, state: row.state })));
          };
        };
      }),
  );
}

/* Waits for the worker to be in charge of this page, from its second load. */
async function controlled(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("a phone an admin signed out keeps its unsent record, and sends it once signed in again", async ({
    adminApi,
    browser,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Playwright WebKit cannot stop the worker's sends (R-138)");
    const member = await freshMember(adminApi, browserName);
    await ensureActiveSession(adminApi);
    const { page, close } = await phone(browser, member.email);
    try {
      await page.goto("/");
      await page.getByRole("link", { name: /Blk 123/ }).click();
      await untilLive(page);
      // On the context, which also sees what passes through the worker.
      await page.context().route("**/api/visits/sync", (route) => route.abort());
      await page.getByLabel("Unit number").fill("#41-01");
      await page.getByRole("radio", { name: "Low" }).click();
      await page.getByRole("button", { name: "Save and next" }).click();
      await expect(page.getByText(/^Saved #41-01 on this phone/)).toBeVisible();

      expect((await adminApi.delete(`/api/users/${member.id}/sign-ins`)).status()).toBe(204);
      await page.context().unroute("**/api/visits/sync");

      /* The phone learns of the end from whichever asks the server first.
         Mostly it is the reload's first API call, refused, and "Signed out"
         says so. But the queue asks who is signed in before every send, and
         an answer given after the end clears the cookie (D-125-4): the
         reload then goes straight to sign-in (#181). */
      await page.reload();
      const toldSignedOut = signedOut(page);
      await expect(
        toldSignedOut.or(page.getByRole("heading", { level: 1, name: "Sign in" })),
      ).toBeVisible();
      expect((await queuedRecords(page)).find((r) => r.unit === "#41-01")?.state).not.toBe(
        "synced",
      );

      if (await toldSignedOut.isVisible()) {
        await page.getByRole("button", { name: "Sign in again" }).click();
        await expect(page).toHaveURL(/\/sign-in\?reason=signed-out$/);
      }
      await page.getByLabel("Email").fill(member.email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      /* Signing in loads the next page in full: read the queue there, not
         from the sign-in page as it is left (#181). */
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

      await expect
        .poll(async () => (await queuedRecords(page)).find((r) => r.unit === "#41-01")?.state)
        .toBe("synced");
      const sent = await adminApi.get(`/api/visits?memberId=${member.id}`);
      expect(((await sent.json()) as { pagination: { total: number } }).pagination.total).toBe(1);
    } finally {
      await close();
    }
  });

  /*
   * #162: an answer the worker is still fetching as the member signs out is
   * not cancelled with the page, and lands after /sign-in has looked,
   * carrying a refreshed cookie (R-137). That cookie names the sign-in the
   * sign-out ended, so it signs nobody back in.
   */
  test("a worker's answer landing after sign-out leaves nobody signed in", async ({
    ownMemberPage: page,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Playwright WebKit cannot hold a worker's request (R-138)");
    await page.goto("/account");
    await controlled(page);
    await expect(page.getByLabel("Your name")).not.toHaveValue("");

    let fetched = false;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.context().route("**/api/users/me", async (route) => {
      if (route.request().headers()["x-e2e-held"] === undefined) return route.fallback();
      // Answered while still signed in, with a refreshed cookie; delivered later.
      const response = await route.fetch();
      fetched = true;
      await released;
      return route.fulfill({ response });
    });
    await page.evaluate(() => {
      void fetch("/api/users/me", { headers: { "x-e2e-held": "1" } }).catch(() => undefined);
    });
    await expect.poll(() => fetched).toBe(true);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    // /sign-in has made its second look (D-129-5): its note is gone.
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("d2d:just-signed-out")))
      .toBeNull();

    release();
    // The late answer did put a cookie back, or this would prove nothing.
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).some(
            (cookie) => cookie.name === SESSION_COOKIE && cookie.value !== "",
          ),
        { intervals: [50] },
      )
      .toBe(true);

    expect((await page.request.get("/api/users/me")).status()).toBe(401);
    expect(await (await page.request.get("/api/auth/session")).json()).toBeNull();
    await page.goto("/history");
    await expect(
      page
        .getByRole("heading", { level: 1, name: "Sign in" })
        .or(page.getByRole("heading", { level: 1, name: "Signed out" })),
    ).toBeVisible();
    await expect(page.getByText(SEED_MEMBER)).toBeHidden();
  });
});
