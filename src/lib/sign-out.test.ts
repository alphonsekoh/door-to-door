import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutAndForget } from "@/lib/sign-out";

const { clear } = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/sw-client", () => ({ clearServiceWorkerCaches: clear }));

beforeEach(() => {
  vi.clearAllMocks();
  clear.mockResolvedValue(undefined);
});

describe("signOutAndForget", () => {
  it("clears the cached lists before signing out, then lands on sign-in", async () => {
    const order: string[] = [];
    clear.mockImplementation(() => Promise.resolve(void order.push("clear")));
    const signOut = vi.fn(() => Promise.resolve(void order.push("signOut")));

    await signOutAndForget(signOut);

    expect(order).toEqual(["clear", "signOut"]);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });

  it("lets a failed sign-out reach the caller", async () => {
    await expect(signOutAndForget(() => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
  });
});
