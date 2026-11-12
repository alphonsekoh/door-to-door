import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { firstOrThrow } from "@/server/db-utils";
import { verifyPassword } from "@/server/password";
import { allowGoogleSignIn } from "@/auth/google";
import { runCreateAdmin, type CreateAdminIo } from "@/server/users/create-admin-cli";
import { ADMIN_EXISTS_MESSAGE, GOOGLE_ONLY_NEEDS_GOOGLE } from "@/server/users/first-admin";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ARGV = ["--email", "lead@example.org"];
/* Google sign-in set up, for the admin's domain among others. */
const GOOGLE = { domains: ["gmail.com", "example.org"] };

function io(overrides: Partial<CreateAdminIo> = {}): CreateAdminIo {
  return {
    argv: ARGV,
    env: {},
    readFile: () => {
      throw new Error("no files here");
    },
    prompt: undefined,
    googleDomains: null,
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

describe("runCreateAdmin for an admin who signs in with Google only (#14)", () => {
  it("takes an empty password and the email typed again, and stores no hash", async () => {
    const prompt = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce(" Lead@Example.org ");
    const created = await runCreateAdmin(db, io({ prompt, googleDomains: GOOGLE.domains }));

    expect(prompt.mock.calls).toEqual([
      ["Password (leave empty for Google sign-in only): "],
      ["Type the email again to confirm: "],
    ]);
    expect(created).toMatchObject({ email: "lead@example.org", googleOnly: true });
    expect(await storedHash()).toBeNull();
    // The way in is Google's, once it vouches for the address (D-105-2).
    const email = "lead@example.org";
    const profile = { email, email_verified: true, hd: "example.org" };
    expect(await allowGoogleSignIn(db, GOOGLE, { email }, profile)).toBe(true);
  });

  it("says a password admin is not Google-only", async () => {
    const created = await runCreateAdmin(
      db,
      io({ env: { ADMIN_PASSWORD: "from-the-env" }, googleDomains: GOOGLE.domains }),
    );
    expect(created.googleOnly).toBe(false);
  });

  it("refuses an email typed differently the second time, and writes nothing", async () => {
    const prompt = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("lead@example.com");
    await expect(runCreateAdmin(db, io({ prompt, googleDomains: GOOGLE.domains }))).rejects.toThrow(
      "The emails did not match, so nothing was changed.",
    );
    expect(await userCount()).toBe(0);
  });

  it("refuses an empty password while Google sign-in is not set up, without asking more", async () => {
    const prompt = vi.fn().mockResolvedValue("");
    await expect(runCreateAdmin(db, io({ prompt }))).rejects.toThrow(GOOGLE_ONLY_NEEDS_GOOGLE);
    expect(prompt.mock.calls).toEqual([["Password: "]]);
    expect(await userCount()).toBe(0);
  });

  it("offers no empty password for an address outside Google's domains, and refuses one", async () => {
    const prompt = vi.fn().mockResolvedValue("");
    await expect(
      runCreateAdmin(db, io({ prompt, googleDomains: ["gmail.com", "tjc.sg"] })),
    ).rejects.toThrow(
      "Google sign-in works only for addresses at gmail.com or tjc.sg (auth.google.domains), so the first admin needs a password.",
    );
    // Refused before the email is asked for again.
    expect(prompt.mock.calls).toEqual([["Password: "]]);
    expect(await userCount()).toBe(0);
  });

  it("still takes a password for an address outside Google's domains", async () => {
    const prompt = vi.fn().mockResolvedValue("typed-at-prompt");
    const created = await runCreateAdmin(db, io({ prompt, googleDomains: ["gmail.com"] }));
    expect(created.googleOnly).toBe(false);
    expect(prompt.mock.calls).toEqual([["Password: "], ["Confirm password: "]]);
  });

  it("still refuses with no terminal and no password, Google or not", async () => {
    await expect(runCreateAdmin(db, io({ googleDomains: GOOGLE.domains }))).rejects.toThrow(
      /No password given/,
    );
    expect(await userCount()).toBe(0);
  });

  it("still works only once (D-105-3)", async () => {
    await pool.query("INSERT INTO users (email, role) VALUES ('first@t.local', 'admin')");
    const prompt = vi.fn();
    await expect(runCreateAdmin(db, io({ prompt, googleDomains: GOOGLE.domains }))).rejects.toThrow(
      ADMIN_EXISTS_MESSAGE,
    );
    expect(prompt).not.toHaveBeenCalled();
  });
});
