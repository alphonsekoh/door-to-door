import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGate } from "@/components/shell/account-gate";
import { accountStore } from "@/lib/session/account-state";

const { usePathname, useRole, sharedCurrentUser, hasUnsynced, replaceWith } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string>(),
  useRole: vi.fn(),
  sharedCurrentUser: vi.fn(),
  hasUnsynced: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname, useSelectedLayoutSegment: () => null }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
vi.mock("@/lib/session/users", () => ({ sharedCurrentUser }));
vi.mock("@/lib/pwa/sw-update", () => ({ hasUnsyncedItems: hasUnsynced }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/session/navigate", () => ({ replaceWith }));

const signedIn = (isSignedIn: boolean) => useRole.mockReturnValue({ isSignedIn });

beforeEach(() => {
  vi.clearAllMocks();
  usePathname.mockReturnValue("/");
  signedIn(true);
  sharedCurrentUser.mockResolvedValue({ id: "u1", role: "member", approval: "approved" });
  hasUnsynced.mockResolvedValue(false);
});

/* The store is the module singleton and failures stick, so the tests that
   raise one load a fresh copy of the gate and its store. */
async function freshGate() {
  vi.resetModules();
  const { AccountGate: Gate } = await import("@/components/shell/account-gate");
  const { accountStore: store } = await import("@/lib/session/account-state");
  return { Gate, store };
}

describe("AccountGate", () => {
  it("renders the app untouched while the account is fine", () => {
    render(
      <AccountGate>
        <button type="button">Save visit</button>
      </AccountGate>,
    );
    const save = screen.getByRole("button", { name: "Save visit" });
    expect(save.closest("[inert]")).toBeNull();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("covers the app with the message and makes it inert once a request is refused", async () => {
    const { Gate, store } = await freshGate();
    render(
      <Gate>
        <button type="button">Try again</button>
      </Gate>,
    );
    act(() => {
      store.reportAuthFailure("deactivated");
    });

    expect(screen.getByRole("alertdialog", { name: "Account deactivated" })).toBeInTheDocument();
    // Inert hides it from the accessibility tree too, so query the DOM directly.
    const retry = screen.getByText("Try again");
    expect(retry.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("alertdialog").closest("[inert]")).toBeNull();
  });

  it("shows the signed-out message for a 401", async () => {
    const { Gate, store } = await freshGate();
    store.reportAuthFailure("signed-out");
    render(<Gate>app</Gate>);
    expect(screen.getByRole("alertdialog", { name: "Signed out" })).toBeInTheDocument();
  });

  it("reads /users/me once for a signed-in member, across navigations", async () => {
    const { rerender } = render(<AccountGate>app</AccountGate>);
    usePathname.mockReturnValue("/history");
    rerender(<AccountGate>other page</AccountGate>);
    await waitFor(() => {
      expect(sharedCurrentUser).toHaveBeenCalledOnce();
    });
  });

  it("does not read /users/me on a public page", () => {
    usePathname.mockReturnValue("/sign-in");
    render(<AccountGate>form</AccountGate>);
    expect(sharedCurrentUser).not.toHaveBeenCalled();
  });

  it("does not read /users/me for nobody, and reads it once the session arrives", () => {
    signedIn(false);
    const { rerender } = render(<AccountGate>app</AccountGate>);
    expect(sharedCurrentUser).not.toHaveBeenCalled();

    signedIn(true);
    rerender(<AccountGate>app</AccountGate>);
    expect(sharedCurrentUser).toHaveBeenCalledOnce();
  });

  it("swallows a failed read: offline is not an account problem", async () => {
    sharedCurrentUser.mockRejectedValue(new Error("offline"));
    render(<AccountGate>app</AccountGate>);
    await waitFor(() => {
      expect(sharedCurrentUser).toHaveBeenCalled();
    });
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(accountStore.getSnapshot().failure).toBeNull();
  });

  it("leaves an approved account where it is", async () => {
    render(<AccountGate>app</AccountGate>);
    await waitFor(() => {
      expect(sharedCurrentUser).toHaveBeenCalled();
    });
    await Promise.resolve();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(replaceWith).not.toHaveBeenCalled();
  });

  /* #249: no message for an account nobody has approved; the waiting page. */
  describe("an account nobody has approved", () => {
    it.each(["pending", "blocked"])(
      "takes an account the once-per-load read finds %s to the waiting page, drawing nothing on the way",
      async (approval) => {
        sharedCurrentUser.mockResolvedValue({ id: "u1", role: "member", approval });
        render(<AccountGate>home screen</AccountGate>);
        await waitFor(() => {
          expect(replaceWith).toHaveBeenCalledWith("/waiting");
        });
        expect(replaceWith).toHaveBeenCalledOnce();
        expect(screen.queryByText("home screen")).not.toBeInTheDocument();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      },
    );

    it("takes it there when any request is refused for it, before the screen's own refusal shows", async () => {
      sharedCurrentUser.mockReturnValue(new Promise(() => undefined));
      const { Gate, store } = await freshGate();
      render(
        <Gate>
          <p>Could not load the session.</p>
        </Gate>,
      );
      act(() => {
        store.reportAuthFailure("unapproved");
      });
      expect(screen.queryByText("Could not load the session.")).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(replaceWith).toHaveBeenCalledWith("/waiting");
    });

    it("leaves the waiting page to answer for itself", async () => {
      usePathname.mockReturnValue("/waiting");
      sharedCurrentUser.mockResolvedValue({ id: "u1", role: "member", approval: "pending" });
      const { Gate, store } = await freshGate();
      render(<Gate>waiting page</Gate>);
      await waitFor(() => {
        expect(sharedCurrentUser).toHaveBeenCalled();
      });
      act(() => {
        store.reportAuthFailure("unapproved");
      });
      expect(screen.getByText("waiting page")).toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(replaceWith).not.toHaveBeenCalled();
    });

    it("lets a waiting account open the privacy policy from the waiting page", async () => {
      usePathname.mockReturnValue("/waiting");
      sharedCurrentUser.mockResolvedValue({ id: "u1", role: "member", approval: "pending" });
      const { Gate } = await freshGate();
      const view = render(<Gate>page</Gate>);
      await waitFor(() => {
        expect(sharedCurrentUser).toHaveBeenCalled();
      });
      await act(() => Promise.resolve());
      usePathname.mockReturnValue("/privacy");
      view.rerender(<Gate>policy</Gate>);
      expect(screen.getByText("policy")).toBeInTheDocument();
      expect(replaceWith).not.toHaveBeenCalled();
    });

    it("still gives the waiting page the signed-out message", async () => {
      usePathname.mockReturnValue("/waiting");
      const { Gate, store } = await freshGate();
      store.reportAuthFailure("signed-out");
      render(<Gate>waiting page</Gate>);
      expect(screen.getByRole("alertdialog", { name: "Signed out" })).toBeInTheDocument();
    });
  });

  it("renders the plain app on the server, whatever this browser was told", async () => {
    // The server cannot know; the message arrives on hydration instead.
    const { Gate, store } = await freshGate();
    store.reportAuthFailure("deactivated");
    const html = renderToString(<Gate>page body</Gate>);
    expect(html).toContain("page body");
    expect(html).not.toContain("alertdialog");
    expect(html).not.toContain("inert");
  });
});
