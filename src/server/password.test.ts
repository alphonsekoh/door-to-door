import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
} from "@/server/password";

describe("hashPassword", () => {
  it("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("never returns the password itself", async () => {
    const password = "correct horse battery";
    expect(await hashPassword(password)).not.toContain(password);
  });

  it("salts, so the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("rejects a password below the minimum length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(WeakPasswordError);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
  });

  it("rejects when the account has no password set", async () => {
    // Google-only accounts carry a null hash and must not be loggable-in.
    expect(await verifyPassword(null, "anything")).toBe(false);
  });

  it("returns false rather than throwing on a corrupt stored hash", async () => {
    // A corrupt row must read as a wrong password, not crash in a way that
    // distinguishes it from a valid account.
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("is case sensitive", async () => {
    const hash = await hashPassword("CaseSensitive");
    expect(await verifyPassword(hash, "casesensitive")).toBe(false);
  });
});

describe("assertPasswordAcceptable", () => {
  it("accepts a password at exactly the minimum length", () => {
    expect(() => {
      assertPasswordAcceptable("a".repeat(MIN_PASSWORD_LENGTH));
    }).not.toThrow();
  });

  it("rejects one character below the minimum", () => {
    expect(() => {
      assertPasswordAcceptable("a".repeat(MIN_PASSWORD_LENGTH - 1));
    }).toThrow(WeakPasswordError);
  });

  it("states the requirement in the message", () => {
    expect(() => {
      assertPasswordAcceptable("");
    }).toThrow(/at least 8 characters/);
  });
});
