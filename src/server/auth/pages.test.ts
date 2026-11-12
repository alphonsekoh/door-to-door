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

const { requireAdminPage } = await import("@/server/auth/pages");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdminPage", () => {
  it("lets an admin through", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "admin", deactivated: false } });
    await expect(requireAdminPage()).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("hides the page from a member", async () => {
    // notFound, not a redirect: the admin area should not advertise itself.
    auth.mockResolvedValue({ user: { id: "u2", role: "member", deactivated: false } });
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
    auth.mockResolvedValue({ user: { id: "u1", role: "admin", deactivated: true } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the page from an admin claim that names no user", async () => {
    auth.mockResolvedValue({ user: { role: "admin" } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
