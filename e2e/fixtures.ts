import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import {
  ADMIN_STATE,
  MEMBER_STATE,
  PARTNER_STATE,
  SEED_BLOCK,
  SEED_LISTED_HOUSEHOLD,
} from "./accounts";

/*
 * An API context carrying the admin's cookies. Shared rather than rebuilt in
 * each spec, and it takes baseURL as it comes: exactOptionalPropertyTypes will
 * not let an explicit undefined through.
 */
export async function adminRequest(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    storageState: ADMIN_STATE,
  });
}

/*
 * Runs in the page. Production React never reports a mismatch of attributes
 * alone: it keeps the server's and moves on, so an attribute worked out from
 * the clock or the timezone (the phone in Singapore, the server in UTC) would
 * go unseen. Once hydrated, each element holds the props React rendered it
 * with, and at rest its attributes agree with them unless hydration kept the
 * server's; so after each load the two are compared, and a difference is
 * logged as a hydration error. Only what React set is compared: an
 * attribute it never rendered, as an extension adds, is not its business.
 */
function sweepHydratedAttributes(): void {
  const XHTML = "http://www.w3.org/1999/xhtml";
  /* Properties rather than attributes, or not attributes at all. */
  const SKIP = new Set([
    "children",
    "value",
    "defaultValue",
    "style",
    "dangerouslySetInnerHTML",
    "nonce",
  ]);
  const NAMES = new Map([
    ["className", "class"],
    ["htmlFor", "for"],
  ]);
  const reported = new Set<string>();
  const sweep = (): void => {
    for (const element of document.body.querySelectorAll("*")) {
      if (element.namespaceURI !== XHTML) continue;
      const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
      if (key === undefined) continue;
      const props: unknown = Reflect.get(element, key);
      if (typeof props !== "object" || props === null || "suppressHydrationWarning" in props) {
        continue;
      }
      for (const [name, value] of Object.entries(props)) {
        if (SKIP.has(name) || (typeof value !== "string" && typeof value !== "number")) continue;
        const client = String(value);
        const server = element.getAttribute(NAMES.get(name) ?? name);
        if (server === client || (server === null && client === "")) continue;
        const line = `Hydration kept the server's ${name}="${String(server)}" on <${element.localName}>; the client rendered "${client}".`;
        if (!reported.has(line)) {
          reported.add(line);
          console.error(line);
        }
      }
    }
  };
  addEventListener("load", () => {
    setTimeout(sweep, 500);
    setTimeout(sweep, 2_000);
  });
}

/*
 * Fails the test on any hydration error: the server's HTML and the client's
 * first render disagreed. React reports what it had to recover from (text or
 * structure: it threw the server's away); the sweep above reports an
 * attribute that differed.
 */
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|hydrat/i;

async function watchHydration(page: Page): Promise<() => void> {
  await page.addInitScript(sweepHydratedAttributes);
  const seen: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && HYDRATION.test(message.text())) {
      seen.push(`${page.url()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (HYDRATION.test(error.message)) seen.push(`${page.url()}: ${error.message}`);
  });
  return () => {
    expect(seen, "hydration errors").toEqual([]);
  };
}

/*
 * Signed-in pages for both roles, plus the one piece of setup more than one
 * spec needs: an outing that is actually running. Every page a fixture hands
 * out is watched for hydration errors.
 */

type Fixtures = {
  adminPage: Page;
  memberPage: Page;
  /* A second member (Ben), for anything that needs two people on one outing. */
  partnerPage: Page;
  /* Admin's cookies, for setting state up over the API rather than by driving
     six screens to reach the one under test. */
  adminApi: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    const check = await watchHydration(page);
    await use(page);
    check();
  },

  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();
    const check = await watchHydration(page);
    await use(page);
    await context.close();
    check();
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MEMBER_STATE });
    const page = await context.newPage();
    const check = await watchHydration(page);
    await use(page);
    await context.close();
    check();
  },

  partnerPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: PARTNER_STATE });
    const page = await context.newPage();
    const check = await watchHydration(page);
    await use(page);
    await context.close();
    check();
  },

  adminApi: async ({ playwright, baseURL }, use) => {
    const request = await adminRequest(playwright, baseURL);
    await use(request);
    await request.dispose();
  },
});

export { expect };

/*
 * A block screen loaded by address is live once its docked Save is the
 * form's own: until then it is the stand-in in the server's HTML, a plain
 * button. Text typed before that is cleared as React takes over the unit
 * field (#113), so a test types only after it.
 */
export async function untilLive(page: Page): Promise<void> {
  /* Only Save in a follow-up session, where no next unit is guessed. */
  await expect(page.getByRole("button", { name: /^Save( and next)?$/ })).toHaveAttribute(
    "type",
    "submit",
  );
}

/*
 * Leaves an outing running with the seeded block attached, whatever state the
 * previous spec left behind. Written to be idempotent rather than ordered:
 * specs that depend on running order are the other way suites go flaky.
 */
export async function ensureActiveSession(api: APIRequestContext): Promise<string> {
  const active = await api.get("/api/sessions/active");

  const sessionId = active.ok()
    ? ((await active.json()) as { session: { id: string } }).session.id
    : await startFreshSession(api);

  await api.post(`/api/sessions/${sessionId}/blocks`, {
    data: { blockIds: [SEED_BLOCK] },
  });
  return sessionId;
}

async function startFreshSession(api: APIRequestContext): Promise<string> {
  const created = await api.post("/api/sessions", {
    data: { title: `E2E session ${new Date().toISOString()}` },
  });
  const { id } = (await created.json()) as { id: string };
  await api.post(`/api/sessions/${id}/start`);
  return id;
}

/*
 * The seeded #05-123 on the follow-up list, owed, whatever an earlier spec
 * did to its note: a follow-up session can pick only a household that is.
 */
export async function listSeededHousehold(api: APIRequestContext): Promise<string> {
  const owed = await api.get(
    `/api/follow-ups?householdId=${SEED_LISTED_HOUSEHOLD}&status=listed&outstanding=true&limit=1`,
  );
  const { pagination } = (await owed.json()) as { pagination: { total: number } };
  if (pagination.total === 0) {
    const added = await api.post("/api/follow-ups", {
      data: { householdId: SEED_LISTED_HOUSEHOLD, note: "Check the weekday timings" },
    });
    expect(added.status()).toBe(201);
  }
  return SEED_LISTED_HOUSEHOLD;
}

/* A follow-up session over the seeded listed unit, running, with nothing else running. */
export async function startFollowUpSession(
  api: APIRequestContext,
  title = "Follow-up visits",
): Promise<string> {
  await endActiveSession(api);
  const household = await listSeededHousehold(api);
  const created = await api.post("/api/sessions", {
    data: { title, kind: "follow_up", householdIds: [household] },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await api.post(`/api/sessions/${id}/start`)).ok()).toBe(true);
  return id;
}

export async function endActiveSession(api: APIRequestContext): Promise<void> {
  const active = await api.get("/api/sessions/active");
  if (!active.ok()) return;
  const { session } = (await active.json()) as { session: { id: string } };
  await api.post(`/api/sessions/${session.id}/end`);
}
