import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import type { SessionLike } from "@/server/auth/guards";
import type { Account } from "@/server/auth/sign-ins";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock("@/db/client", () => ({ getDatabase }));

const { checkSignIn } = vi.hoisted(() => ({ checkSignIn: vi.fn() }));
vi.mock("@/server/auth/sign-ins", () => ({ checkSignIn }));

const { currentSession, currentSignIn, currentUser, resolveSession } =
  await import("@/server/auth/session");

const db = {} as Database;
const SIGN_IN = "22222222-0000-4000-8000-000000000002";
const account: Account = { email: "a@t.local", name: "A", role: "member", deactivatedAt: null };
const live = (overrides: Partial<Account> = {}) => ({
  status: "live",
  account: { ...account, ...overrides },
  signInId: SIGN_IN,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSession", () => {
  it("builds the session from the row and the live sign-in, ignoring the token's role", async () => {
    checkSignIn.mockResolvedValue(live());
    const session = await resolveSession(db, {
      user: { id: "u1", role: "admin", deactivated: false },
      signInId: SIGN_IN,
    });
    expect(session).toEqual({
      user: { id: "u1", email: "a@t.local", name: "A", role: "member", deactivated: false },
      signInId: SIGN_IN,
    });
    expect(checkSignIn).toHaveBeenCalledWith(db, "u1", SIGN_IN);
  });

  it("marks a deactivated account deactivated, whatever its sign-in, with none on the session", async () => {
    checkSignIn.mockResolvedValue({ status: "deactivated", account });
    const session = await resolveSession(db, {
      user: { id: "u1", role: "member", deactivated: false },
    });
    expect(session).toEqual({
      user: { id: "u1", email: "a@t.local", name: "A", role: "member", deactivated: true },
    });
  });

  it.each(["no-user", "ended"])("treats a %s sign-in as signed out (#125)", async (status) => {
    checkSignIn.mockResolvedValue({ status, account });
    expect(await resolveSession(db, { user: { id: "u1" }, signInId: SIGN_IN })).toBeNull();
  });

  it.each<SessionLike>([
    null,
    {},
    { user: {} },
    { user: null },
    { user: { id: "" } },
    { user: { role: "admin" } },
    { user: { role: "admin", deactivated: false } },
  ])("treats %j as signed out without a lookup", async (session) => {
    expect(await resolveSession(db, session)).toBeNull();
    expect(checkSignIn).not.toHaveBeenCalled();
  });

  it("does not fail open when the lookup throws", async () => {
    checkSignIn.mockRejectedValue(new Error("connection refused"));
    await expect(resolveSession(db, { user: { id: "u1", role: "admin" } })).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("currentSession and currentUser", () => {
  it("does not touch the database for a signed-out request", async () => {
    auth.mockResolvedValue(null);
    expect(await currentSession()).toBeNull();
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("resolve the token against the database", async () => {
    getDatabase.mockReturnValue(db);
    checkSignIn.mockResolvedValue(live({ role: "admin" }));
    auth.mockResolvedValue({ user: { id: "u1", role: "member" }, signInId: SIGN_IN });
    expect((await currentSession())?.user.role).toBe("admin");
    expect(await currentUser("admin")).toMatchObject({ id: "u1", role: "admin" });
    expect(await currentUser()).toMatchObject({ id: "u1" });
  });

  it("refuses admin to a member and a deactivated account", async () => {
    getDatabase.mockReturnValue(db);
    checkSignIn.mockResolvedValue(live());
    auth.mockResolvedValue({ user: { id: "u1", role: "admin" }, signInId: SIGN_IN });
    await expect(currentUser("admin")).rejects.toMatchObject({ status: 403 });

    checkSignIn.mockResolvedValue({ status: "deactivated", account });
    await expect(currentUser()).rejects.toMatchObject({ code: "account_deactivated" });
  });
});

describe("currentSignIn", () => {
  beforeEach(() => {
    getDatabase.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: "u1" }, signInId: SIGN_IN });
  });

  it("gives the caller and the sign-in making the request", async () => {
    checkSignIn.mockResolvedValue(live({ role: "admin" }));
    expect(await currentSignIn("admin")).toEqual({
      user: { id: "u1", email: "a@t.local", name: "A", role: "admin", deactivated: false },
      signInId: SIGN_IN,
    });
    expect((await currentSignIn()).user.id).toBe("u1");
  });

  it("is 401 signed out, 403 deactivated and 403 for a member asking as an admin", async () => {
    checkSignIn.mockResolvedValue({ status: "ended", account });
    await expect(currentSignIn("admin")).rejects.toMatchObject({ status: 401 });

    checkSignIn.mockResolvedValue({ status: "deactivated", account });
    await expect(currentSignIn("admin")).rejects.toMatchObject({ code: "account_deactivated" });

    checkSignIn.mockResolvedValue(live());
    await expect(currentSignIn("admin")).rejects.toMatchObject({ code: "forbidden" });
  });
});
