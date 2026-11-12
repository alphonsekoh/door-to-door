import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Credentials from "@/server/auth/credentials";
import type { Database } from "@/db/client";
import { allowGoogleSignIn, googleDomains } from "@/auth/google";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

const { findUserForSignIn } = vi.hoisted(() => ({ findUserForSignIn: vi.fn() }));
vi.mock("@/server/auth/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof Credentials>()),
  findUserForSignIn,
}));

const db = {} as Database;
const GOOGLE = { domains: ["gmail.com", "tjc.sg", "tjc.org"] };
const ALICE = { id: "a", email: "alice@gmail.com", deactivatedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  findUserForSignIn.mockResolvedValue(ALICE);
});

describe("googleDomains", () => {
  it("follows auth.google in config.yaml: its domains, or null when it is not set up", () => {
    getConfig.mockReturnValue({ auth: { google: { clientId: "id", domains: ["gmail.com"] } } });
    expect(googleDomains()).toEqual(["gmail.com"]);
    getConfig.mockReturnValue({ auth: {} });
    expect(googleDomains()).toBeNull();
  });
});

describe("allowGoogleSignIn (#14)", () => {
  const verified = { email: "Alice@Gmail.com", email_verified: true };

  it("lets in the active account an admin added, once Google has verified its address", async () => {
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, verified)).toBe(true);
    expect(findUserForSignIn).toHaveBeenCalledWith(db, "alice@gmail.com");
  });

  it.each([
    ["an unverified address", { email: "alice@gmail.com", email_verified: false }],
    [
      "a verification that is not a plain true",
      { email: "alice@gmail.com", email_verified: "true" },
    ],
    ["no address", { email_verified: true }],
    ["no profile", undefined],
  ])("refuses %s without a lookup", async (_name, profile) => {
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, profile)).toBe(false);
    expect(findUserForSignIn).not.toHaveBeenCalled();
  });

  it("refuses everyone, without a lookup, while Google sign-in is not set up", async () => {
    expect(await allowGoogleSignIn(db, undefined, { email: "alice@gmail.com" }, verified)).toBe(
      false,
    );
    expect(findUserForSignIn).not.toHaveBeenCalled();
  });

  it("refuses an address nobody added, and a deactivated account", async () => {
    findUserForSignIn.mockResolvedValueOnce(undefined);
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, verified)).toBe(false);
    findUserForSignIn.mockResolvedValueOnce({ ...ALICE, deactivatedAt: new Date() });
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, verified)).toBe(false);
  });

  it("refuses when the account Auth.js would sign in is not the one with that address", async () => {
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "ben@gmail.com" }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, GOOGLE, { email: null }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, GOOGLE, undefined, verified)).toBe(false);
  });
});

/* The owner's ruling of 2026-11-12: only where Google vouches for the address. */
describe("allowGoogleSignIn: where Google vouches for the address", () => {
  const judge = (email: string, hd?: unknown) =>
    allowGoogleSignIn(
      db,
      GOOGLE,
      { email },
      { email, email_verified: true, ...(hd === undefined ? {} : { hd }) },
    );

  beforeEach(() => {
    findUserForSignIn.mockImplementation((_db: Database, email: string) =>
      Promise.resolve({ ...ALICE, email }),
    );
  });

  it.each([
    ["a gmail.com address, which never carries hd", "ann@gmail.com", undefined],
    ["a listed Workspace domain whose hd is its own", "ann@tjc.sg", "tjc.sg"],
    ["hd in any case", "ann@tjc.sg", "TJC.sg"],
    ["a listed secondary domain, whose hd names the primary", "ann@tjc.org", "tjc.sg"],
  ])("accepts %s", async (_name, email, hd) => {
    expect(await judge(email, hd)).toBe(true);
  });

  it.each([
    ["a listed domain without hd: a consumer Google account on it", "ann@tjc.sg", undefined],
    ["hd naming a domain not listed", "ann@tjc.sg", "elsewhere.example"],
    ["hd that is not a string", "ann@tjc.sg", ["tjc.sg"]],
    ["an unlisted domain, even with its own hd", "ann@example.org", "example.org"],
    ["an unlisted domain whose hd is listed", "ann@example.org", "tjc.sg"],
    ["a subdomain of a listed one", "ann@mail.tjc.sg", "tjc.sg"],
  ])("refuses %s, without a lookup", async (_name, email, hd) => {
    expect(await judge(email, hd)).toBe(false);
    expect(findUserForSignIn).not.toHaveBeenCalled();
  });

  it("fails closed for a domain listed by mistake that is not on Workspace", async () => {
    const google = { domains: ["gmail.com", "isp.example"] };
    const email = "ann@isp.example";
    expect(await allowGoogleSignIn(db, google, { email }, { email, email_verified: true })).toBe(
      false,
    );
  });
});
