import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { E2E_OPERATOR } from "./e2e/operator";
import { FAKE_GOOGLE_CLIENT_ID, FAKE_GOOGLE_CLIENT_SECRET } from "./e2e/fake-google";

/*
 * A deliberately thin E2E layer. Vitest owns UI coverage; these specs exist
 * to catch the breakage between layers that no jsdom test can see -
 * including layout, which is how a Save button ended up under the bottom nav
 * and shipped through three PRs and eleven hundred passing tests.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3210);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

/* A stand-in for Google's sign-in (#14): nothing here may need the real one. */
const GOOGLE_PORT = Number(process.env["E2E_GOOGLE_PORT"] ?? PORT + 1000);
const GOOGLE_ISSUER = `http://127.0.0.1:${String(GOOGLE_PORT)}`;

/* Its own database, on the scratch server the integration suite already uses.
   A separate name rather than a separate container: e2e truncates and reseeds,
   which would pull the rug out from under a concurrent integration run. */
const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ??
  "postgresql://postgres:postgres@localhost:5433/door_to_door_e2e";

/*
 * The app reads its settings from a YAML file and its credentials from the
 * environment, exactly as in production. So the one full URL the harness uses
 * is split here: the file gets the URL without credentials, the server process
 * gets them as DATABASE_USER and DATABASE_PASSWORD.
 *
 * Written when this config loads, and the path is absolute: the standalone
 * server changes directory to its own folder, so a relative one would miss.
 */
const target = new URL(E2E_DATABASE_URL);
const CREDENTIALS = {
  DATABASE_USER: decodeURIComponent(target.username),
  DATABASE_PASSWORD: decodeURIComponent(target.password),
};
target.username = "";
target.password = "";
const CONFIG_PATH = resolve("e2e/.auth/config.yaml");
mkdirSync(dirname(CONFIG_PATH), { recursive: true });
/* The suite runs over plain http, where WebKit drops a Secure cookie. Google
   sign-in is set up against the stand-in, so the sign-in page offers it. */
writeFileSync(
  CONFIG_PATH,
  stringify({
    database: { url: target.toString() },
    privacy: { organisation: E2E_OPERATOR, dpoEmail: "dpo@example.com" },
    auth: {
      secureCookies: false,
      google: {
        clientId: FAKE_GOOGLE_CLIENT_ID,
        issuer: GOOGLE_ISSUER,
        domains: ["gmail.com", "tjc.sg", "tjc.org"],
      },
    },
  }),
);

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
    /* The phone at UTC+14 and the server at UTC-12 (webServer's TZ below):
       26 hours apart, so whatever the hour the phone's date is a day or two
       ahead of the server's and its clock two hours on. Deployed, a phone in
       Singapore and a server in UTC disagree on the date for only part of
       the day, so a bug in a date worked out from "today" would pass a run
       at the wrong hour. Anything rendered from the date, the hour or the
       timezone differs here between the server's HTML and the client's
       first render, and the fixtures fail a test on it: React's own error
       for text or structure, and their sweep of hydrated attributes for an
       attribute, which production React keeps from the server without a
       word. Only pages loaded while a test runs are checked. */
    timezoneId: "Pacific/Kiritimati",
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

  webServer: [
    {
      /*
       * The production build, not the dev server: dev compiles on first
       * request and the first navigation of a run would eat the timeout.
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
        /* UTC-12: the POSIX sign is the other way round. */
        TZ: "Etc/GMT+12",
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        CONFIG_PATH,
        ...CREDENTIALS,
        AUTH_SECRET: process.env["AUTH_SECRET"] ?? "e2e-secret-not-used-anywhere-else",
        AUTH_GOOGLE_SECRET: FAKE_GOOGLE_CLIENT_SECRET,
      },
    },
    {
      command: "npx tsx e2e/fake-google.ts",
      url: `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: { FAKE_GOOGLE_PORT: String(GOOGLE_PORT) },
    },
  ],
});
