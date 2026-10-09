import { chromium, type FullConfig } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";
import {
  ADMIN_STATE,
  MEMBER_STATE,
  PARTNER_STATE,
  SEED_ADMIN,
  SEED_MEMBER,
  SEED_PARTNER,
  SEED_PASSWORD,
} from "./accounts";

/*
 * Brings the e2e database to exactly the seeded state, then signs both roles
 * in once and saves their cookies.
 *
 * Reseeding is not enough on its own: the seed upserts, so outings and visits
 * left by an earlier run would still be there and the counts a spec asserts
 * would drift upwards. Everything is truncated first.
 */

const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ??
  "postgresql://postgres:postgres@localhost:5433/door_to_door_e2e";

/* Creating it here rather than in compose keeps the scratch server to one
   container while giving e2e a database the integration suite never touches. */
async function ensureDatabase(): Promise<void> {
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1);
  const server = new Pool({
    connectionString: E2E_DATABASE_URL.replace(`/${name}`, "/postgres"),
    max: 1,
  });
  try {
    const existing = await server.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      /* Identifier, so it cannot be parameterised; the name comes from our own
         configuration rather than from any request. */
      await server.query(`create database "${name}"`);
    }
  } finally {
    await server.end();
  }
}

async function resetAndSeed(): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const { truncateAll } = await import("../src/db/testing");
    await truncateAll(pool);
  } finally {
    await pool.end();
  }

  /* Imported rather than shelled out to, so a seed failure is a stack trace
     here instead of a non-zero exit code with no context. */
  const { seedDatabase } = await import("../scripts/seed");
  await seedDatabase(E2E_DATABASE_URL);
}

async function signInAndSave(baseURL: string, email: string, path: string): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  /* Waits on having left the sign-in page, not on a timer: a fixed pause here
     is the first place a suite goes flaky. */
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  mkdirSync(dirname(path), { recursive: true });
  await context.storageState({ path });
  await browser.close();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) {
    throw new Error("e2e needs a baseURL to sign in against");
  }

  await ensureDatabase();
  await resetAndSeed();
  await signInAndSave(baseURL, SEED_ADMIN, ADMIN_STATE);
  await signInAndSave(baseURL, SEED_MEMBER, MEMBER_STATE);
  await signInAndSave(baseURL, SEED_PARTNER, PARTNER_STATE);
}
