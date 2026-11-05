import type { Adapter } from "next-auth/adapters";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";
import { buildAuthConfig } from "@/server/auth/config";

/*
 * The adapter is configured against tables we renamed - auth_sessions rather
 * than sessions, because outing_sessions is the domain concept. A mapping
 * mistake would only show up at sign-in, so it is exercised here instead.
 */

const pool = createTestPool();

/* Asserted rather than cast: a config with no adapter is a real misconfiguration. */
function requireAdapter(): Adapter {
  const { adapter } = buildAuthConfig();
  if (!adapter) {
    throw new Error("Auth config has no adapter configured.");
  }
  return adapter;
}

const adapter = requireAdapter();

const seedUser = async (email: string, role: "admin" | "member" = "member") => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role) VALUES ($1, 'Test User', $2) RETURNING id`,
    [email, role],
  );
  return rows[0]?.id ?? "";
};

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("Drizzle adapter wiring", () => {
  it("reads a user by email from our users table", async () => {
    await seedUser("admin@test.local", "admin");
    const user = await adapter.getUserByEmail?.("admin@test.local");
    expect(user?.email).toBe("admin@test.local");
  });

  it("returns null for an unknown email rather than throwing", async () => {
    expect(await adapter.getUserByEmail?.("nobody@test.local")).toBeNull();
  });

  it("never creates a user: only an admin adds anyone (#14)", async () => {
    await expect(
      adapter.createUser?.({
        id: crypto.randomUUID(),
        email: "new@test.local",
        emailVerified: null,
      }),
    ).rejects.toMatchObject({ type: "AccessDenied" });

    const { rows } = await pool.query(`SELECT 1 FROM users`);
    expect(rows).toHaveLength(0);
  });

  it("never reads the user of a cookie already on the phone, so no Google account is linked to them (#14)", async () => {
    const userId = await seedUser("signed-in@test.local");
    expect(await adapter.getUser?.(userId)).toBeNull();
  });

  it("links an account to a user in our accounts table", async () => {
    const userId = await seedUser("linked@test.local");
    await adapter.linkAccount?.({
      userId,
      type: "oauth",
      provider: "google",
      providerAccountId: "google-123",
    });

    const found = await adapter.getUserByAccount?.({
      provider: "google",
      providerAccountId: "google-123",
    });
    expect(found?.email).toBe("linked@test.local");
  });

  it("reaches auth_sessions, despite the table not being called sessions", async () => {
    /*
     * Unused at runtime because the strategy is JWT, but the adapter contract
     * requires it. If the mapping were wrong this would throw.
     */
    const userId = await seedUser("session@test.local");
    const session = await adapter.createSession?.({
      sessionToken: "token-123",
      userId,
      expires: new Date(Date.now() + 60_000),
    });
    expect(session?.sessionToken).toBe("token-123");

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM auth_sessions WHERE session_token = 'token-123'`,
    );
    expect(rows[0]?.count).toBe("1");
  });
});

describe("session strategy", () => {
  it("uses JWTs, which the Credentials provider requires", () => {
    expect(buildAuthConfig().session?.strategy).toBe("jwt");
  });

  it("sends users to our own sign-in page", () => {
    expect(buildAuthConfig().pages?.signIn).toBe("/sign-in");
  });
});
