import {
  test as base,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { ADMIN_STATE, MEMBER_STATE, SEED_BLOCK } from "./accounts";

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

  adminApi: async ({ playwright, baseURL }, use) => {
    const request = await adminRequest(playwright, baseURL);
    await use(request);
    await request.dispose();
  },
});

export { expect } from "@playwright/test";

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
    data: { title: `E2E outing ${new Date().toISOString()}` },
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
