import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Credentials from "@/server/auth/credentials";
import type { Database } from "@/db/client";
import { allowGoogleSignIn, googleSignInEnabled } from "@/auth/google";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

const { findUserForSignIn } = vi.hoisted(() => ({ findUserForSignIn: vi.fn() }));
vi.mock("@/server/auth/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof Credentials>()),
  findUserForSignIn,
}));

const db = {} as Database;
const ALICE = { id: "a", email: "alice@t.local", deactivatedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  findUserForSignIn.mockResolvedValue(ALICE);
});

describe("googleSignInEnabled", () => {
  it("follows auth.google in config.yaml", () => {
    getConfig.mockReturnValue({ auth: { google: { clientId: "id" } } });
    expect(googleSignInEnabled()).toBe(true);
    getConfig.mockReturnValue({ auth: {} });
    expect(googleSignInEnabled()).toBe(false);
  });
});

describe("allowGoogleSignIn (#14)", () => {
  const verified = { email: "Alice@T.local", email_verified: true };

  it("lets in the active account an admin added, once Google has verified its address", async () => {
    expect(await allowGoogleSignIn(db, { email: "alice@t.local" }, verified)).toBe(true);
    expect(findUserForSignIn).toHaveBeenCalledWith(db, "alice@t.local");
  });

  it.each([
    ["an unverified address", { email: "alice@t.local", email_verified: false }],
    ["a verification that is not a plain true", { email: "alice@t.local", email_verified: "true" }],
    ["no address", { email_verified: true }],
    ["no profile", undefined],
  ])("refuses %s without a lookup", async (_name, profile) => {
    expect(await allowGoogleSignIn(db, { email: "alice@t.local" }, profile)).toBe(false);
    expect(findUserForSignIn).not.toHaveBeenCalled();
  });

  it("refuses an address nobody added, and a deactivated account", async () => {
    findUserForSignIn.mockResolvedValueOnce(undefined);
    expect(await allowGoogleSignIn(db, { email: "alice@t.local" }, verified)).toBe(false);
    findUserForSignIn.mockResolvedValueOnce({ ...ALICE, deactivatedAt: new Date() });
    expect(await allowGoogleSignIn(db, { email: "alice@t.local" }, verified)).toBe(false);
  });

  it("refuses when the account Auth.js would sign in is not the one with that address", async () => {
    expect(await allowGoogleSignIn(db, { email: "ben@t.local" }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, { email: null }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, undefined, verified)).toBe(false);
  });
});
