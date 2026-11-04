import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthFailureScreen } from "@/components/shell/auth-failure-screen";
import { ConfirmDialog } from "@/components/ui/sheet";

const { signOut, signOutAndForget, hasUnsynced, role } = vi.hoisted(() => ({
  signOut: vi.fn(),
  signOutAndForget: vi.fn(),
  hasUnsynced: vi.fn(),
  role: { userId: undefined as string | undefined },
}));

vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("@/lib/session/sign-out", () => ({ signOutAndForget }));
vi.mock("@/lib/pwa/sw-update", () => ({ hasUnsyncedItems: hasUnsynced }));
/* The member whose records are asked about: their own, never the phone's
   other users' (D-33-1). */
vi.mock("@/lib/hooks/use-role", () => ({ useRole: () => role }));

beforeEach(() => {
  vi.clearAllMocks();
  role.userId = "u1";
  hasUnsynced.mockResolvedValue(false);
  signOutAndForget.mockResolvedValue(undefined);
});

describe("AuthFailureScreen", () => {
  it("tells a deactivated member to ask an admin, and offers only Sign out", () => {
    render(<AuthFailureScreen kind="deactivated" />);
    const dialog = screen.getByRole("alertdialog", { name: "Account deactivated" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("This account has been deactivated. Ask an admin.");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Sign out"]);
  });

  it("tells a member whose session ended that they were signed out", () => {
    render(<AuthFailureScreen kind="signed-out" />);
    expect(screen.getByRole("alertdialog", { name: "Signed out" })).toHaveTextContent(
      "You've been signed out.",
    );
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Sign in again",
    ]);
  });

  it("puts focus on the only way forward", () => {
    render(<AuthFailureScreen kind="deactivated" />);
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });

  it("signs a deactivated member out to the sign-in page", async () => {
    const user = userEvent.setup();
    render(<AuthFailureScreen kind="deactivated" />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    // Its own navigation, which leaves no way Back to this screen (#129).
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, "u1", "/sign-in");
  });

  it("signs out first, then asks for a fresh sign-in with the reason", async () => {
    // Signing out clears the cookie a deleted account leaves behind.
    const user = userEvent.setup();
    render(<AuthFailureScreen kind="signed-out" />);
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, "u1", "/sign-in?reason=signed-out");
  });

  it("names nobody to the sign-out once the page has lost the member too", async () => {
    // So no sent record goes: none can be told to be theirs (D-129-6).
    role.userId = undefined;
    const user = userEvent.setup();
    render(<AuthFailureScreen kind="signed-out" />);
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, undefined, "/sign-in?reason=signed-out");
  });

  it("holds the button while signing out", async () => {
    const user = userEvent.setup();
    signOutAndForget.mockReturnValue(new Promise(() => undefined));
    render(<AuthFailureScreen kind="deactivated" />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
  });

  it("stays up with an error when the sign-out is refused, and can be retried", async () => {
    const user = userEvent.setup();
    signOutAndForget.mockRejectedValueOnce(new Error("Sign-out was refused: MissingCSRF"));
    render(<AuthFailureScreen kind="deactivated" />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out. Try again.");
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toBeEnabled();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(signOutAndForget).toHaveBeenCalledTimes(2);
  });

  it("says unsent records stay on the phone when there are some", async () => {
    hasUnsynced.mockResolvedValue(true);
    render(<AuthFailureScreen kind="deactivated" />);
    expect(
      await screen.findByText("Records not yet sent are kept on this phone."),
    ).toBeInTheDocument();
    expect(hasUnsynced).toHaveBeenCalledWith("u1");
  });

  it("says nothing about records when none are waiting", async () => {
    render(<AuthFailureScreen kind="deactivated" />);
    await waitFor(() => {
      expect(hasUnsynced).toHaveBeenCalled();
    });
    expect(screen.queryByText(/kept on this phone/)).not.toBeInTheDocument();
  });

  it("cannot be dismissed with Escape", async () => {
    const user = userEvent.setup();
    render(<AuthFailureScreen kind="deactivated" />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Account deactivated" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });

  it("puts focus back on the button after a refused sign-out", async () => {
    const user = userEvent.setup();
    let refuse: (reason: Error) => void = () => undefined;
    signOutAndForget.mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    render(<AuthFailureScreen kind="deactivated" />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    // jsdom keeps focus on a disabled control; a browser does not. Stand in
    // for wherever the browser left it.
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    act(() => {
      elsewhere.focus();
    });

    await act(async () => {
      refuse(new Error("Sign-out was refused: MissingCSRF"));
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
    elsewhere.remove();
  });

  describe("over a confirm dialog", () => {
    function Page({ confirm, failed }: { confirm: boolean; failed: boolean }) {
      return (
        <>
          {confirm ? (
            <ConfirmDialog
              title="Remove block?"
              detail="It comes off this outing."
              confirmLabel="Remove"
              busy={false}
              onConfirm={vi.fn()}
              onCancel={onCancel}
            />
          ) : null}
          {failed ? <AuthFailureScreen kind="deactivated" /> : null}
        </>
      );
    }
    const onCancel = vi.fn();

    it("takes the keyboard from one already open, which Escape no longer closes", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Page confirm failed={false} />);
      rerender(<Page confirm failed />);

      expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
      await user.tab();
      expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
    });

    it("keeps one opened afterwards beneath it, unfocused and inert", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Page confirm={false} failed />);
      rerender(<Page confirm failed />);

      expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
      // Inert hides it from the accessibility tree, so query the DOM directly.
      expect(screen.getByText("Keep as it is").closest("[inert]")).not.toBeNull();
      await user.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
