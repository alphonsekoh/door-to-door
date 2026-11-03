import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { zCreateUserRequest } from "@/generated/zod.gen";
import { MAX_PASSWORD_LENGTH } from "@/server/password";
import {
  CreateAdminError,
  checkAdminEmail,
  checkAdminName,
  checkAdminPassword,
  createFirstAdmin,
} from "@/server/users/first-admin";

describe("checkAdminEmail", () => {
  it("stores the address the way POST /users does: trimmed and lower-cased", () => {
    expect(checkAdminEmail("  Lead@Example.ORG ")).toBe("lead@example.org");
  });

  it("refuses something that is not an email address", () => {
    expect(() => checkAdminEmail("lead-at-example")).toThrow(CreateAdminError);
    expect(() => checkAdminEmail("lead-at-example")).toThrow(
      '"lead-at-example" is not a valid email address.',
    );
  });

  it("refuses an address longer than the contract allows", () => {
    expect(() => checkAdminEmail(`${"a".repeat(310)}@example.org`)).toThrow(/not a valid email/);
  });
});

describe("checkAdminPassword", () => {
  it("refuses fewer than 8 characters with the app's own message", () => {
    expect(() => {
      checkAdminPassword("short");
    }).toThrow("Password must be at least 8 characters.");
  });

  it("accepts the contract's maximum and refuses one more", () => {
    expect(MAX_PASSWORD_LENGTH).toBe(zCreateUserRequest.shape.password.maxLength);
    expect(() => {
      checkAdminPassword("p".repeat(MAX_PASSWORD_LENGTH));
    }).not.toThrow();
    expect(() => {
      checkAdminPassword("p".repeat(MAX_PASSWORD_LENGTH + 1));
    }).toThrow("Password must be at most 200 characters.");
  });
});

describe("checkAdminName", () => {
  it("trims a name as a rename would", () => {
    expect(checkAdminName("  Lead Organiser ")).toBe("Lead Organiser");
  });

  it("refuses a name that would render blank", () => {
    expect(() => checkAdminName("​")).toThrow(CreateAdminError);
  });
});

describe("createFirstAdmin", () => {
  it("refuses bad input before touching the database", async () => {
    const transaction = vi.fn();
    const stub = { transaction } as unknown as Database;

    await expect(
      createFirstAdmin(stub, { email: "lead@example.org", name: null, password: "short" }),
    ).rejects.toThrow(/at least 8 characters/);
    await expect(
      createFirstAdmin(stub, { email: "lead@example.org", name: " ", password: "password123" }),
    ).rejects.toThrow("Enter your name.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rethrows an unrelated database failure rather than calling it a taken email", async () => {
    const stub = {
      transaction: () => Promise.reject(new Error("connection reset")),
    } as unknown as Database;

    await expect(
      createFirstAdmin(stub, { email: "lead@example.org", name: null, password: "password123" }),
    ).rejects.toThrow("connection reset");
  });
});
