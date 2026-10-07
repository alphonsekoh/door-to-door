import { defineConfig, devices } from "@playwright/test";

/*
 * A deliberately thin E2E layer. Vitest owns UI coverage; these three flows
 * exist to catch the breakage between layers that no jsdom test can see -
 * including layout, which is how a Save button ended up under the bottom nav
 * and shipped through three PRs and eleven hundred passing tests.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3210);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

/* Its own database, on the scratch server the integration suite already uses.
   A separate name rather than a separate container: e2e truncates and reseeds,
   which would pull the rug out from under a concurrent integration run. */
const DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ??
  "postgresql://postgres:postgres@localhost:5433/door_to_door_e2e";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  /*
   * One worker, and specs in file order. The app allows one active outing at a
   * time by database constraint, so parallel specs would fight over it - and a
   * suite that races its own fixtures is worse than no suite.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  /* No retries: a flaky E2E test that passes on the second go teaches nobody
     anything. If one fails it should stay failed until it is understood. */
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    /* Phone profiles - viewport, touch and mobile user agent - are set per
       project below; this is the only place the app is exercised at that size. */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  /*
   * Chromium on a Pixel 5 and WebKit on an iPhone. WebKit is there because
   * every browser on iOS runs it, and the PWA work (#32) is where Safari
   * differs most: service workers, storage and the install flow.
   */
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],

  webServer: {
    /*
     * The production build, not the dev server: dev compiles on first request
     * and the first navigation of a run would eat the timeout.
     *
     * `next start` refuses to serve a standalone build - it warns and then
     * hands back a shell with no client bundle, which looks exactly like a
     * broken sign-in form. The standalone server is what Docker runs too.
     */
    command: "npm run build && npm run start:standalone",
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL,
      AUTH_SECRET: process.env["AUTH_SECRET"] ?? "e2e-secret-not-used-anywhere-else",
      AUTH_TRUST_HOST: "true",
    },
  },
});
