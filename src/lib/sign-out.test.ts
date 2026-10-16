import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutAndForget } from "@/lib/sign-out";
import { isLeavingOnPurpose } from "@/lib/navigate";

const { clear } = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/sw-client", () => ({ clearServiceWorkerCaches: clear }));

// What Auth.js hands back when the session really ended.
const signedOut = { url: "http://localhost:3210/account" };

beforeEach(() => {
  vi.clearAllMocks();
  clear.mockResolvedValue(undefined);
});

describe("signOutAndForget", () => {
  it("clears the cached lists, signs out, then goes to sign-in by relative path", async () => {
    const order: string[] = [];
    clear.mockImplementation(() => Promise.resolve(void order.push("clear")));
    const signOut = vi.fn(() => {
      order.push("signOut");
      return Promise.resolve(signedOut);
    });
    const navigate = vi.fn((path: string) => void order.push(`go ${path}`));

    await signOutAndForget(signOut, navigate);

    expect(order).toEqual(["clear", "signOut", "go /sign-in"]);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("still signs out when the caches cannot be cleared", async () => {
    clear.mockRejectedValue(new Error("storage unavailable"));
    const signOut = vi.fn(() => Promise.resolve(signedOut));
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

  it("does not claim success when Auth.js refuses the sign-out", async () => {
    // A CSRF mismatch comes back as 200 with an error page URL, and the
    // session cookie is still valid.
    const navigate = vi.fn();
    await expect(
      signOutAndForget(
        () => Promise.resolve({ url: "http://localhost:3210/sign-in?error=MissingCSRF" }),
        navigate,
      ),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates with window.location by default, as a departure the member chose", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign }, addEventListener: vi.fn() });
    await signOutAndForget(() => Promise.resolve(signedOut));
    expect(assign).toHaveBeenCalledWith("/sign-in");
    // So the unsent-records warning does not stop it (D-33-23).
    expect(isLeavingOnPurpose()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("goes wherever the caller asks once signed out", async () => {
    const navigate = vi.fn();
    await signOutAndForget(
      () => Promise.resolve(signedOut),
      navigate,
      "/sign-in?reason=signed-out",
    );
    expect(navigate).toHaveBeenCalledWith("/sign-in?reason=signed-out");
  });

  it("still refuses to navigate to a custom destination after a refusal", async () => {
    const navigate = vi.fn();
    await expect(
      signOutAndForget(
        () => Promise.resolve({ url: "http://localhost:3210/sign-in?error=MissingCSRF" }),
        navigate,
        "/sign-in?reason=signed-out",
      ),
    ).rejects.toThrow("MissingCSRF");
    expect(navigate).not.toHaveBeenCalled();
  });
});
