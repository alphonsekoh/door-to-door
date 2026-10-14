import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthFailureScreen } from "@/components/auth-failure-screen";

const { signOut, signOutAndForget, hasUnsynced, goTo } = vi.hoisted(() => ({
  signOut: vi.fn(),
  signOutAndForget: vi.fn(),
  hasUnsynced: vi.fn(),
  goTo: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("@/lib/sign-out", () => ({ signOutAndForget }));
vi.mock("@/lib/sw-update", () => ({ hasUnsyncedItems: hasUnsynced }));
vi.mock("@/lib/navigate", () => ({ goTo }));

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, goTo, "/sign-in");
  });

  it("signs out first, then asks for a fresh sign-in with the reason", async () => {
    // Signing out clears the cookie a deleted account leaves behind.
    const user = userEvent.setup();
    render(<AuthFailureScreen kind="signed-out" />);
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, goTo, "/sign-in?reason=signed-out");
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
  });

  it("says nothing about records when none are waiting", async () => {
    render(<AuthFailureScreen kind="deactivated" />);
    await waitFor(() => {
      expect(hasUnsynced).toHaveBeenCalled();
    });
    expect(screen.queryByText(/kept on this phone/)).not.toBeInTheDocument();
  });

  it("makes a sheet portalled to the body inert while it is up, and releases it after", () => {
    const sheet = document.createElement("div");
    const alreadyInert = document.createElement("div");
    alreadyInert.setAttribute("inert", "");
    document.body.append(sheet, alreadyInert);

    const { unmount, container } = render(<AuthFailureScreen kind="deactivated" />);
    expect(sheet).toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("inert");

    unmount();
    expect(sheet).not.toHaveAttribute("inert");
    // Not ours to release.
    expect(alreadyInert).toHaveAttribute("inert");
    sheet.remove();
    alreadyInert.remove();
  });
});
