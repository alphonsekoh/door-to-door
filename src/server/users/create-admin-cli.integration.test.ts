import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { firstOrThrow } from "@/server/db-utils";
import { verifyPassword } from "@/server/password";
import { runCreateAdmin, type CreateAdminIo } from "@/server/users/create-admin-cli";
import { ADMIN_EXISTS_MESSAGE } from "@/server/users/first-admin";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ARGV = ["--email", "lead@example.org"];

function io(overrides: Partial<CreateAdminIo> = {}): CreateAdminIo {
  return {
    argv: ARGV,
    env: {},
    readFile: () => {
      throw new Error("no files here");
    },
    prompt: undefined,
    ...overrides,
  };
}

async function storedHash(): Promise<string | null> {
  const { rows } = await pool.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE email = 'lead@example.org' AND role = 'admin'",
  );
  return firstOrThrow(rows, "the new admin").password_hash;
}

async function userCount(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  return firstOrThrow(rows, "the user count").n;
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("runCreateAdmin password sources", () => {
  it("takes the password from ADMIN_PASSWORD", async () => {
    await runCreateAdmin(db, io({ env: { ADMIN_PASSWORD: "from-the-env" } }));
    expect(await verifyPassword(await storedHash(), "from-the-env")).toBe(true);
  });

  it("takes it from the file ADMIN_PASSWORD_FILE names, without the trailing newline", async () => {
    await runCreateAdmin(
      db,
      io({
        env: { ADMIN_PASSWORD_FILE: "/run/secrets/admin" },
        readFile: (path) => (path === "/run/secrets/admin" ? "from-a-file\n" : ""),
      }),
    );
    expect(await verifyPassword(await storedHash(), "from-a-file")).toBe(true);
  });

  it("asks twice on a terminal and uses the confirmed answer", async () => {
    const prompt = vi.fn().mockResolvedValue("typed-at-prompt");
    await runCreateAdmin(db, io({ prompt }));

    expect(prompt.mock.calls).toEqual([["Password: "], ["Confirm password: "]]);
    expect(await verifyPassword(await storedHash(), "typed-at-prompt")).toBe(true);
  });

  it("prefers the environment over prompting", async () => {
    const prompt = vi.fn();
    await runCreateAdmin(db, io({ env: { ADMIN_PASSWORD: "from-the-env" }, prompt }));
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("runCreateAdmin refusals change nothing", () => {
  it("refuses when an admin exists, before asking for a password", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('first@t.local', 'admin')");
    const prompt = vi.fn();

    await expect(runCreateAdmin(db, io({ prompt }))).rejects.toThrow(ADMIN_EXISTS_MESSAGE);
    expect(prompt).not.toHaveBeenCalled();
    expect(await userCount()).toBe(1);
  });

  it("refuses when the confirmation does not match", async () => {
    const prompt = vi
      .fn()
      .mockResolvedValueOnce("first-answer")
      .mockResolvedValueOnce("second-answer");

    await expect(runCreateAdmin(db, io({ prompt }))).rejects.toThrow(
      "The passwords did not match, so nothing was changed.",
    );
    expect(await userCount()).toBe(0);
  });

  it("refuses a short password at the first prompt without asking to confirm it", async () => {
    const prompt = vi.fn().mockResolvedValue("short");

    await expect(runCreateAdmin(db, io({ prompt }))).rejects.toThrow(/at least 8 characters/);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await userCount()).toBe(0);
  });

  it("refuses a short ADMIN_PASSWORD", async () => {
    await expect(runCreateAdmin(db, io({ env: { ADMIN_PASSWORD: "short" } }))).rejects.toThrow(
      /at least 8 characters/,
    );
    expect(await userCount()).toBe(0);
  });

  it("refuses with no password source rather than reading a pipe", async () => {
    await expect(runCreateAdmin(db, io())).rejects.toThrow(
      /No password given: set ADMIN_PASSWORD or ADMIN_PASSWORD_FILE, or run this in a terminal/,
    );
    expect(await userCount()).toBe(0);
  });

  it("refuses bad arguments before reaching the database", async () => {
    await expect(runCreateAdmin(db, io({ argv: [] }))).rejects.toThrow(/email is required/);
    expect(await userCount()).toBe(0);
  });
});
