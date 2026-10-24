import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { ADMIN_STATE, MEMBER_STATE, PARTNER_STATE, SEED_BLOCK } from "./accounts";

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
 * Signed-in pages for both roles, plus the one piece of setup more than one
 * spec needs: an outing that is actually running.
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
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MEMBER_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  partnerPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: PARTNER_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
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

export async function endActiveSession(api: APIRequestContext): Promise<void> {
  const active = await api.get("/api/sessions/active");
  if (!active.ok()) return;
  const { session } = (await active.json()) as { session: { id: string } };
  await api.post(`/api/sessions/${session.id}/end`);
}
