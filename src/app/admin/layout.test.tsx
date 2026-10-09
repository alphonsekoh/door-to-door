import { describe, expect, it, vi } from "vitest";

const { requireAdminPage } = vi.hoisted(() => ({ requireAdminPage: vi.fn() }));
vi.mock("@/server/auth/pages", () => ({ requireAdminPage }));

const { default: AdminLayout } = await import("./layout");

describe("AdminLayout", () => {
  it("renders its children for an admin", async () => {
    requireAdminPage.mockResolvedValue(undefined);
    const children = <p>inside</p>;
    expect(await AdminLayout({ children })).toBe(children);
  });

  it("renders nothing for anyone the guard refuses", async () => {
    requireAdminPage.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AdminLayout({ children: <p>inside</p> })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
