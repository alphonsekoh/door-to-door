import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutAndForget } from "@/lib/sign-out";

const { clear } = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/sw-client", () => ({ clearServiceWorkerCaches: clear }));

beforeEach(() => {
  vi.clearAllMocks();
  clear.mockResolvedValue(undefined);
});

describe("signOutAndForget", () => {
  it("clears the cached lists, signs out, then goes to sign-in by relative path", async () => {
    const order: string[] = [];
    clear.mockImplementation(() => Promise.resolve(void order.push("clear")));
    const signOut = vi.fn(() => Promise.resolve(void order.push("signOut")));
    const navigate = vi.fn((path: string) => void order.push(`go ${path}`));

    await signOutAndForget(signOut, navigate);

    expect(order).toEqual(["clear", "signOut", "go /sign-in"]);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("still signs out when the caches cannot be cleared", async () => {
    clear.mockRejectedValue(new Error("storage unavailable"));
    const signOut = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();

    await signOutAndForget(signOut, navigate);

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("does not navigate when the sign-out itself fails", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.reject(new Error("offline")), navigate),
    ).rejects.toThrow("offline");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates with window.location by default", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    await signOutAndForget(() => Promise.resolve());
    expect(assign).toHaveBeenCalledWith("/sign-in");
    vi.unstubAllGlobals();
  });
});
