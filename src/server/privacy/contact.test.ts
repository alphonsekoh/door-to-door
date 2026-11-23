import { describe, expect, it, vi } from "vitest";

const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({
    privacy: { organisation: "Example Operator", dpoEmail: "dpo@example.com" },
  })),
}));
vi.mock("@/server/config", () => ({ getConfig }));

describe("privacyContact", () => {
  it("reads the config's privacy section on each call, never at import", async () => {
    const { privacyContact } = await import("@/server/privacy/contact");
    expect(getConfig).not.toHaveBeenCalled();

    expect(privacyContact()).toEqual({
      organisation: "Example Operator",
      dpoEmail: "dpo@example.com",
    });
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
