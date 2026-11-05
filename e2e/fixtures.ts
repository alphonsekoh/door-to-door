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
  SEED_ADMIN,
  SEED_BLOCK,
  SEED_LISTED_HOUSEHOLD,
  SEED_MEMBER,
  SEED_PASSWORD,
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

/* The sessionStorage key where the page keeps every difference it found,
   and the event that has it sweep again: the fixture's teardown fires one
   and reads the other. Kept in storage rather than only logged, since
   Chromium drops what a page logs as it is left, and storage outlives a
   navigation in the tab. */
const MISMATCHES = "e2e:hydration-mismatches";
const SWEEP = "e2e:sweep-hydrated-attributes";

/*
 * Runs in the page. Production React never reports a mismatch of attributes
 * alone: it keeps the server's and moves on, so an attribute worked out from
 * the clock or the timezone (the phone and the server a day apart) would go
 * unseen. Once hydrated, each element holds the props React rendered it
 * with, and at rest its attributes agree with them unless hydration kept the
 * server's; so after each load, as the page is left and at the end of the
 * test, the two are compared, and a difference is logged as a hydration
 * error. Only what React set is compared: an attribute it never rendered, as
 * an extension adds, is not its business.
 */
function sweepHydratedAttributes([mismatches, event]: [string, string]): void {
  const XHTML = "http://www.w3.org/1999/xhtml";
  const SKIP = new Set([
    /* Properties rather than attributes, or not attributes at all. */
    "children",
    "value",
    "defaultValue",
    "checked",
    "defaultChecked",
    "selected",
    "multiple",
    "muted",
    "style",
    "dangerouslySetInnerHTML",
    "nonce",
    /* Set by hand on what is behind a sheet (use-modal.ts). */
    "inert",
  ]);
  const NAMES = new Map([
    ["className", "class"],
    ["htmlFor", "for"],
  ]);
  /* Booleans React writes as an attribute present or absent... */
  const PRESENCE = new Set([
    "disabled",
    "hidden",
    "required",
    "readOnly",
    "noValidate",
    "formNoValidate",
    "open",
    "reversed",
    "async",
    "defer",
    "autoPlay",
    "controls",
    "loop",
    "playsInline",
    "allowFullScreen",
  ]);
  /* ...and those it spells out as "true" or "false". Any other boolean it
     leaves off the element. */
  const spelled = (name: string): boolean =>
    name.startsWith("aria-") ||
    name.startsWith("data-") ||
    ["draggable", "spellCheck", "contentEditable"].includes(name);
  const shown = (value: string | null): string => (value === null ? "absent" : `"${value}"`);

  const reported: string[] = [];
  /* Kept with the page it was found on, as the console's are reported. */
  const keep = (line: string): void => {
    const entry = `${location.href}: ${line}`;
    try {
      const kept: unknown = JSON.parse(sessionStorage.getItem(mismatches) ?? "[]");
      const lines = Array.isArray(kept)
        ? kept.filter((stored): stored is string => typeof stored === "string")
        : [];
      if (!lines.includes(entry)) {
        sessionStorage.setItem(mismatches, JSON.stringify([...lines, entry]));
      }
    } catch {
      /* No storage here, such as on an error page: the console still has it. */
    }
  };
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
        if (SKIP.has(name)) continue;
        const server = element.getAttribute(NAMES.get(name) ?? name);
        let client: string | null;
        if (typeof value === "string" || typeof value === "number") {
          client = String(value);
          if (server === null && client === "") continue;
        } else if (typeof value === "boolean" && PRESENCE.has(name)) {
          if ((server !== null) === value) continue;
          client = value ? "" : null;
        } else if (typeof value === "boolean" && spelled(name)) {
          client = String(value);
        } else {
          continue;
        }
        if (server === client) continue;
        const line = `Hydration kept the server's ${name} ${shown(server)} on <${element.localName}>; the client rendered ${shown(client)}.`;
        if (!reported.includes(line)) {
          reported.push(line);
          console.error(line);
          keep(line);
        }
      }
    }
  };
  /* Every 100ms for the first two seconds, as a test may leave a page as soon
     as it is hydrated; then as it is left, and from the teardown. */
  addEventListener("load", () => {
    const often = setInterval(sweep, 100);
    setTimeout(() => {
      clearInterval(often);
      sweep();
    }, 2_000);
  });
  addEventListener("pagehide", sweep);
  addEventListener(event, sweep);
}

/* The last look, and every difference found in this tab. A page closed,
   between documents or off the app's origin has nothing more to say. */
async function sweepNow(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(
      ([mismatches, event]) => {
        dispatchEvent(new Event(event));
        const kept: unknown = JSON.parse(sessionStorage.getItem(mismatches) ?? "[]");
        return Array.isArray(kept)
          ? kept.filter((line): line is string => typeof line === "string")
          : [];
      },
      [MISMATCHES, SWEEP] as const,
    );
  } catch {
    return [];
  }
}

/*
 * Fails the test on any hydration error: the server's HTML and the client's
 * first render disagreed. React reports what it had to recover from (text or
 * structure: it threw the server's away); the sweep above reports an
 * attribute that differed.
 */
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|hydrat/i;

async function watchHydration(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(sweepHydratedAttributes, [MISMATCHES, SWEEP] as [string, string]);
  const seen: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && HYDRATION.test(message.text())) {
      seen.push(`${page.url()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (HYDRATION.test(error.message)) seen.push(`${page.url()}: ${error.message}`);
  });
  /* Run before the page closes; asserts on everything seen. */
  return async () => {
    for (const entry of await sweepNow(page)) {
      if (!seen.includes(entry)) seen.push(entry);
    }
    expect(seen, "hydration errors").toEqual([]);
  };
}

/* Every CSP violation a page saw, kept in its tab as the mismatches are. */
const VIOLATIONS = "e2e:csp-violations";

/*
 * Runs in the page. The policy only reports (#146), so a violation breaks
 * nothing and no test would notice one; but the browser fires this event for
 * a report-only policy as for an enforced one, and a suite that records none
 * on either engine is the evidence for enforcing it. Nothing is filtered: a
 * violation is either the app's to fix or the policy's.
 */
function recordCspViolations(violations: string): void {
  /* Dispatched at the document or the offending element, and it bubbles. */
  document.addEventListener("securitypolicyviolation", (event) => {
    const blocked = event.blockedURI === "" ? "(inline)" : event.blockedURI;
    const sample = event.sample === "" ? "" : ` "${event.sample}"`;
    const line =
      `${location.href}: CSP ${event.disposition} violation of ${event.effectiveDirective}: ` +
      `${blocked}${sample} from ${event.sourceFile}:${String(event.lineNumber)}`;
    console.error(line);
    try {
      const kept: unknown = JSON.parse(sessionStorage.getItem(violations) ?? "[]");
      const lines = Array.isArray(kept)
        ? kept.filter((stored): stored is string => typeof stored === "string")
        : [];
      if (!lines.includes(line)) {
        sessionStorage.setItem(violations, JSON.stringify([...lines, line]));
      }
    } catch {
      /* No storage here: the console still has it. */
    }
  });
}

const CSP_LINE = /: CSP (report|enforce) violation of /;

async function watchCsp(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(recordCspViolations, VIOLATIONS);
  const seen: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && CSP_LINE.test(message.text())) seen.push(message.text());
  });
  return async () => {
    let kept: string[] = [];
    try {
      kept = await page.evaluate((violations) => {
        const stored: unknown = JSON.parse(sessionStorage.getItem(violations) ?? "[]");
        return Array.isArray(stored)
          ? stored.filter((line): line is string => typeof line === "string")
          : [];
      }, VIOLATIONS);
    } catch {
      /* A page closed, between documents or off the app's origin. */
    }
    for (const line of kept) {
      if (!seen.includes(line)) seen.push(line);
    }
    expect(seen, "CSP violations").toEqual([]);
  };
}

/* Both watchers on one page; run the result before the page closes. */
async function watch(page: Page): Promise<() => Promise<void>> {
  const hydration = await watchHydration(page);
  const csp = await watchCsp(page);
  return async () => {
    await hydration();
    await csp();
  };
}

/*
 * Signed-in pages for both roles, plus the one piece of setup more than one
 * spec needs: an outing that is actually running. Every page a fixture hands
 * out is watched for hydration errors and CSP violations.
 */

type Fixtures = {
  adminPage: Page;
  memberPage: Page;
  /* A second member (Ben), for anything that needs two people on one outing. */
  partnerPage: Page;
  /* Signed in through the form, on a sign-in of their own (#125). Any test
     that signs out, or ends a sign-in, uses one of these: the saved
     sign-ins above are shared by every spec after it. */
  ownAdminPage: Page;
  ownMemberPage: Page;
  /* Admin's cookies, for setting state up over the API rather than by driving
     six screens to reach the one under test. */
  adminApi: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    const check = await watch(page);
    await use(page);
    await check();
  },

  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();
    const check = await watch(page);
    await use(page);
    try {
      await check();
    } finally {
      await context.close();
    }
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MEMBER_STATE });
    const page = await context.newPage();
    const check = await watch(page);
    await use(page);
    try {
      await check();
    } finally {
      await context.close();
    }
  },

  partnerPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: PARTNER_STATE });
    const page = await context.newPage();
    const check = await watch(page);
    await use(page);
    try {
      await check();
    } finally {
      await context.close();
    }
  },

  ownAdminPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const check = await watch(page);
    await signInThroughForm(page, SEED_ADMIN);
    await use(page);
    try {
      await check();
    } finally {
      await context.close();
    }
  },

  ownMemberPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const check = await watch(page);
    await signInThroughForm(page, SEED_MEMBER);
    await use(page);
    try {
      await check();
    } finally {
      await context.close();
    }
  },

  adminApi: async ({ playwright, baseURL }, use) => {
    const request = await adminRequest(playwright, baseURL);
    await use(request);
    await request.dispose();
  },
});

export { expect };

/*
 * Signs in with email and password as a phone does, starting a sign-in of its
 * own (#125). The button is "Sign in" exactly: "Sign in with Google" sits
 * above it.
 */
export async function signInThroughForm(
  page: Page,
  email: string,
  password = SEED_PASSWORD,
  path = "/sign-in",
): Promise<void> {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/*
 * A block screen loaded by address is live once its docked Save is the
 * form's own: until then it is the stand-in in the server's HTML, a plain
 * button, and a tap on it saves nothing. What is typed and picked before
 * then is kept (#113), so a test waits for this only before it taps Save.
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
