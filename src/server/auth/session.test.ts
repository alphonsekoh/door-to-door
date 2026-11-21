import * as React from "react";
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

/* React as Next's server renderer loads it, whose cache keeps answers for
   one render. Vitest would load the browser build, whose cache keeps none. */
vi.mock("react", async () => {
  const nodeModule = await import("node:module");
  return nodeModule.createRequire(import.meta.url)(
    `${process.cwd()}/node_modules/react/react.react-server.js`,
  ) as unknown;
});

const { currentSession, currentSignIn, currentUser, resolveSession } =
  await import("@/server/auth/session");

const db = {} as Database;
const SIGN_IN = "22222222-0000-4000-8000-000000000002";
const account: Account = {
  email: "a@t.local",
  name: "A",
  role: "member",
  approval: "approved",
  deactivatedAt: null,
};
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
      user: {
        id: "u1",
        email: "a@t.local",
        name: "A",
        role: "member",
        approval: "approved",
        deactivated: false,
      },
      signInId: SIGN_IN,
    });
    expect(checkSignIn).toHaveBeenCalledWith(db, "u1", SIGN_IN);
  });

  it("carries the row's approval, which the token never has (#249)", async () => {
    checkSignIn.mockResolvedValue(live({ approval: "pending" }));
    const session = await resolveSession(db, { user: { id: "u1", role: "member" } });
    expect(session?.user.approval).toBe("pending");
  });

  it("marks a deactivated account deactivated, whatever its sign-in, with none on the session", async () => {
    checkSignIn.mockResolvedValue({ status: "deactivated", account });
    const session = await resolveSession(db, {
      user: { id: "u1", role: "member", deactivated: false },
    });
    expect(session).toEqual({
      user: {
        id: "u1",
        email: "a@t.local",
        name: "A",
        role: "member",
        approval: "approved",
        deactivated: true,
      },
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

  it("refuses an account nobody has approved, however it signed in (#249)", async () => {
    getDatabase.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: "u1", role: "member" }, signInId: SIGN_IN });
    checkSignIn.mockResolvedValue(live({ approval: "pending" }));
    await expect(currentUser()).rejects.toMatchObject({ status: 403, code: "account_pending" });
    checkSignIn.mockResolvedValue(live({ approval: "blocked" }));
    await expect(currentUser("admin")).rejects.toMatchObject({ code: "account_blocked" });
    await expect(currentSignIn()).rejects.toMatchObject({ code: "account_blocked" });
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
      user: {
        id: "u1",
        email: "a@t.local",
        name: "A",
        role: "admin",
        approval: "approved",
        deactivated: false,
      },
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

/*
 * What the renderer does for each request it renders: hands React a cache
 * that lasts as long as the render. Outside one, as in a route handler, the
 * cache keeps nothing.
 */
type Dispatcher = { getCacheForType: <T>(create: () => T) => T };
const internals = (
  React as unknown as {
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: Dispatcher | null };
  }
).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

async function oneRender(work: () => Promise<unknown>): Promise<void> {
  const caches = new Map<unknown, unknown>();
  internals.A = {
    getCacheForType<T>(create: () => T): T {
      if (!caches.has(create)) caches.set(create, create());
      return caches.get(create) as T;
    },
  };
  try {
    await work();
  } finally {
    internals.A = null;
  }
}

describe("one sign-in check per render (#252)", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: "u1" }, signInId: SIGN_IN });
    getDatabase.mockReturnValue(db);
  });

  it("is shared by an admin page's layout and the page itself", async () => {
    checkSignIn.mockResolvedValue(live({ role: "admin" }));
    await oneRender(async () => {
      await currentUser("admin");
      await currentSession();
    });
    expect(checkSignIn).toHaveBeenCalledOnce();
  });

  it("is made again by the next request's render", async () => {
    checkSignIn.mockResolvedValue(live({ role: "admin" }));
    await oneRender(() => currentUser("admin"));
    checkSignIn.mockResolvedValue({ status: "deactivated", account });
    await oneRender(async () => {
      await expect(currentUser("admin")).rejects.toMatchObject({ code: "account_deactivated" });
    });
    expect(checkSignIn).toHaveBeenCalledTimes(2);
  });

  it("is made by every call outside a render, as a route handler makes them", async () => {
    checkSignIn.mockResolvedValue(live());
    await currentSignIn();
    await currentUser();
    expect(checkSignIn).toHaveBeenCalledTimes(2);
  });

  it("fails every caller in the render when the lookup fails, never letting one through", async () => {
    checkSignIn.mockRejectedValue(new Error("db down"));
    await oneRender(async () => {
      await expect(currentUser("admin")).rejects.toThrow("db down");
      await expect(currentSession()).rejects.toThrow("db down");
    });
    expect(checkSignIn).toHaveBeenCalledOnce();
  });
});
