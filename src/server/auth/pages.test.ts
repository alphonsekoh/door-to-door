import { describe, expect, it, vi, beforeEach } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ currentSession: auth }));

const { notFound, redirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect }));

const { requireAdminPage, requireWaitingPage } = await import("@/server/auth/pages");

const account = (user: Record<string, unknown>) => ({
  user: {
    id: "u1",
    email: "u1@t.local",
    name: "U",
    role: "member",
    approval: "approved",
    deactivated: false,
    ...user,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdminPage", () => {
  it("lets an admin through", async () => {
    auth.mockResolvedValue(account({ role: "admin" }));
    await expect(requireAdminPage()).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("hides the page from a member", async () => {
    // notFound, not a redirect: the admin area should not advertise itself.
    auth.mockResolvedValue(account({ id: "u2" }));
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sends a request with no live sign-in to sign in again, as the API's 401 would (#125)", async () => {
    // An ended sign-in passes the proxy, which has no database to see it end.
    auth.mockResolvedValue(null);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?reason=signed-out");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("hides the page from a deactivated admin", async () => {
    // The role survives in the JWT until it expires; deactivation must win.
    auth.mockResolvedValue(account({ role: "admin", deactivated: true }));
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the page from an admin claim that names no user", async () => {
    auth.mockResolvedValue({ user: { role: "admin", approval: "approved" } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["pending", "blocked"])(
    "sends an account that is %s to the waiting page, the one it may see (#249)",
    async (approval) => {
      auth.mockResolvedValue(account({ approval }));
      await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT /waiting");
      expect(notFound).not.toHaveBeenCalled();
    },
  );
});

describe("requireWaitingPage (#249)", () => {
  it.each(["pending", "blocked"])(
    "gives an account that is %s its own details",
    async (approval) => {
      auth.mockResolvedValue(account({ approval }));
      expect(await requireWaitingPage()).toEqual({ email: "u1@t.local", name: "U", approval });
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("sends an approved account home: it has nothing to wait for", async () => {
    auth.mockResolvedValue(account({}));
    await expect(requireWaitingPage()).rejects.toThrow(/^NEXT_REDIRECT \/$/);
  });

  it("sends a request with no live sign-in to sign in again", async () => {
    auth.mockResolvedValue(null);
    await expect(requireWaitingPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?reason=signed-out");
  });
});
