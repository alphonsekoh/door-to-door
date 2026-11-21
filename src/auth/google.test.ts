import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import type * as Credentials from "@/server/auth/credentials";
import type { Database } from "@/db/client";
import {
  SignInRefused,
  allowGoogleSignIn,
  googleDomains,
  googleName,
  linkByEmailOnly,
} from "@/auth/google";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

const { createAccessRequest } = vi.hoisted(() => ({ createAccessRequest: vi.fn() }));
vi.mock("@/server/users/service", () => ({ createAccessRequest }));

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

  it("refuses a deactivated account, which is never put back in the queue", async () => {
    findUserForSignIn.mockResolvedValueOnce({ ...ALICE, deactivatedAt: new Date() });
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, verified)).toBe(false);
  });

  it("refuses when the account Auth.js would sign in is not the one with that address", async () => {
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "ben@gmail.com" }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, GOOGLE, { email: null }, verified)).toBe(false);
    expect(await allowGoogleSignIn(db, GOOGLE, undefined, verified)).toBe(false);
  });
});

/* #249: a first sign-in asks to join, where it used to be refused. */
describe("allowGoogleSignIn: an address with no account", () => {
  const verified = { email: "New@Gmail.com", email_verified: true };

  beforeEach(() => {
    findUserForSignIn.mockResolvedValue(undefined);
  });

  it("lets a first sign-in through to ask to join", async () => {
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "new@gmail.com" }, verified)).toBe(true);
  });

  it("refuses a Google account already linked to someone else, whose address it now carries", async () => {
    // Auth.js hands over the linked account, Alice, for a Google account now at a new address.
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "alice@gmail.com" }, verified)).toBe(false);
  });

  it("still refuses where Google does not vouch for the address, without a lookup", async () => {
    const consumer = { email: "new@tjc.sg", email_verified: true };
    expect(await allowGoogleSignIn(db, GOOGLE, { email: "new@tjc.sg" }, consumer)).toBe(false);
    expect(findUserForSignIn).not.toHaveBeenCalled();
  });
});

describe("allowGoogleSignIn: an account nobody has approved", () => {
  const verified = { email: "pat@gmail.com", email_verified: true };

  it.each(["pending", "blocked"])(
    "lets an account that is %s sign in, to see where it stands",
    async (approval) => {
      findUserForSignIn.mockResolvedValueOnce({ ...ALICE, email: "pat@gmail.com", approval });
      expect(await allowGoogleSignIn(db, GOOGLE, { email: "pat@gmail.com" }, verified)).toBe(true);
    },
  );
});

describe("googleName (#249)", () => {
  it("keeps a name a member could give themselves, trimmed", () => {
    expect(googleName("  Pat Tan ")).toBe("Pat Tan");
  });

  it.each([
    ["no name at all", undefined],
    ["a name that is not a string", 42],
    ["a blank name", "   "],
    ["a name that renders as nothing", "\u200b\u200b"],
    ["a name past the limit", "x".repeat(81)],
  ])("keeps none for %s", (_case, name) => {
    expect(googleName(name)).toBeNull();
  });
});

describe("linkByEmailOnly", () => {
  const getUser = vi.fn();
  const getUserByEmail = vi.fn();
  const createUser = vi.fn();
  const base = { getUser, getUserByEmail, createUser } as unknown as Adapter;
  const profile: AdapterUser = {
    id: "google-sub-123",
    email: "New@Gmail.com",
    emailVerified: null,
    name: "Pat",
    image: "https://example.com/picture.png",
  };

  it("never reads a user from a cookie already on the phone", async () => {
    const adapter = linkByEmailOnly(base, db);
    expect(await adapter.getUser?.("someone-signed-in")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    // Finding the account by its address is the adapter's own.
    await adapter.getUserByEmail?.("pat@gmail.com");
    expect(getUserByEmail).toHaveBeenCalledWith("pat@gmail.com");
  });

  it("makes a first sign-in a request waiting for approval, never with Google's id or picture", async () => {
    const created = {
      id: "6006e000-0000-4000-8000-000000000009",
      email: "new@gmail.com",
      emailVerified: null,
      name: "Pat",
      image: null,
      role: "member",
      deactivatedAt: null,
    };
    createAccessRequest.mockResolvedValueOnce(created);
    expect(await linkByEmailOnly(base, db).createUser?.(profile)).toBe(created);
    expect(createAccessRequest).toHaveBeenCalledWith(db, { email: "new@gmail.com", name: "Pat" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("names nobody when Google gave no name", async () => {
    createAccessRequest.mockResolvedValueOnce({});
    await linkByEmailOnly(base, db).createUser?.({
      id: profile.id,
      email: profile.email,
      emailVerified: null,
    });
    expect(createAccessRequest).toHaveBeenCalledWith(db, { email: "new@gmail.com", name: null });
  });

  it("refuses the later of two first sign-ins at the same address", async () => {
    createAccessRequest.mockResolvedValueOnce(null);
    await expect(linkByEmailOnly(base, db).createUser?.(profile)).rejects.toBeInstanceOf(
      SignInRefused,
    );
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
