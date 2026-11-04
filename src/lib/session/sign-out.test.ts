import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutAndForget } from "@/lib/session/sign-out";
import { isLeavingOnPurpose } from "@/lib/session/navigate";

const { clear, clearLocalCopy, forgetSentRecords } = vi.hoisted(() => ({
  clear: vi.fn(),
  clearLocalCopy: vi.fn(),
  forgetSentRecords: vi.fn(),
}));
vi.mock("@/lib/pwa/sw-client", () => ({ clearServiceWorkerCaches: clear }));
vi.mock("@/lib/offline/local-copy-store", () => ({ clearLocalCopy }));
vi.mock("@/lib/sync/forget-sent", () => ({ forgetSentRecords }));

// What Auth.js hands back when the session really ended.
const signedOut = { url: "http://localhost:3210/account" };
const refused = { url: "http://localhost:3210/sign-in?error=MissingCSRF" };

beforeEach(() => {
  vi.clearAllMocks();
  clear.mockResolvedValue(undefined);
  clearLocalCopy.mockResolvedValue(undefined);
  forgetSentRecords.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signOutAndForget", () => {
  it("clears the cached lists, the copy and sent records, signs out, then goes to sign-in by relative path", async () => {
    const order: string[] = [];
    clear.mockImplementation(() => Promise.resolve(void order.push("clear")));
    clearLocalCopy.mockImplementation(() => Promise.resolve(void order.push("forget copy")));
    forgetSentRecords.mockImplementation(() => Promise.resolve(void order.push("forget sent")));
    const signOut = vi.fn(() => {
      order.push("signOut");
      return Promise.resolve(signedOut);
    });
    const navigate = vi.fn((path: string) => void order.push(`go ${path}`));

    await signOutAndForget(signOut, undefined, navigate);

    expect(order).toEqual(["clear", "forget copy", "forget sent", "signOut", "go /sign-in"]);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it.each([
    ["the caches cannot be cleared", clear],
    ["the offline copy cannot be cleared", clearLocalCopy],
    ["sent records cannot be forgotten", forgetSentRecords],
  ])("still signs out when %s", async (_, failing) => {
    failing.mockRejectedValue(new Error("IndexedDB is unavailable"));
    const signOut = vi.fn(() => Promise.resolve(signedOut));
    const navigate = vi.fn();

    await signOutAndForget(signOut, undefined, navigate);

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("does not navigate when the sign-out itself fails", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.reject(new Error("offline")), undefined, navigate),
    ).rejects.toThrow("offline");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not claim success when Auth.js refuses the sign-out", async () => {
    // A CSRF mismatch comes back as 200 with an error page URL, and the
    // session cookie is still valid.
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.resolve(refused), undefined, navigate),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("replaces the page in history by default, as a departure the member chose", async () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { assign, replace } });

    await signOutAndForget(() => Promise.resolve(signedOut));

    // So Back from sign-in cannot return to the signed-in screen (#129).
    expect(replace).toHaveBeenCalledWith("/sign-in");
    expect(assign).not.toHaveBeenCalled();
    // So the unsent-records warning does not stop it (D-33-23).
    expect(isLeavingOnPurpose()).toBe(true);
  });

  it("goes wherever the caller asks once signed out, replacing the page there too", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });

    await signOutAndForget(() => Promise.resolve(signedOut), "/sign-in?reason=signed-out");

    expect(replace).toHaveBeenCalledWith("/sign-in?reason=signed-out");
  });

  it("still refuses to navigate to a custom destination after a refusal", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(() => Promise.resolve(refused), "/sign-in?reason=signed-out", navigate),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });
});
