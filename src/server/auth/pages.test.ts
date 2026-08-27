import { describe, expect, it, vi, beforeEach } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound }));

const { requireAdminPage } = await import("@/server/auth/pages");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdminPage", () => {
  it("lets an admin through", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "admin", deactivated: false } });
    await expect(requireAdminPage()).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("hides the page from a member", async () => {
    // notFound, not a redirect: the admin area should not advertise itself.
    auth.mockResolvedValue({ user: { id: "u2", role: "member", deactivated: false } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the page from a signed-out visitor", async () => {
    auth.mockResolvedValue(null);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the page from a deactivated admin", async () => {
    // The role survives in the JWT until it expires; deactivation must win.
    auth.mockResolvedValue({ user: { id: "u1", role: "admin", deactivated: true } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
