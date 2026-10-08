import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountScreen } from "@/components/account-screen";
import type { User } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch, update, signOut, hasUnsynced, signOutAndForget } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  update: vi.fn(),
  signOut: vi.fn(),
  hasUnsynced: vi.fn(),
  signOutAndForget: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ update }), signOut }));
vi.mock("@/lib/sw-update", () => ({ hasUnsyncedItems: hasUnsynced }));
vi.mock("@/lib/sign-out", () => ({ signOutAndForget }));
vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof ApiClientModule>("@/lib/api-client")),
  apiFetch,
}));

const { ApiRequestError } = await import("@/lib/api-client");

const alice: User = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  image: null,
  role: "member",
  deactivatedAt: null,
  lastRecordedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue(alice);
  update.mockResolvedValue(null);
  hasUnsynced.mockResolvedValue(false);
  signOutAndForget.mockResolvedValue(undefined);
});

async function loaded() {
  render(<AccountScreen />);
  return screen.findByLabelText("Your name");
}

describe("AccountScreen: loading", () => {
  it("prefills the name and shows email and role as plain text", async () => {
    expect(await loaded()).toHaveValue("Alice");
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("starts empty for somebody with no name, and labels an admin", async () => {
    apiFetch.mockResolvedValue({ ...alice, name: null, role: "admin" });
    expect(await loaded()).toHaveValue("");
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("says so when the details cannot be loaded", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(500, undefined));
    render(<AccountScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("uses a generic message for a failure that is not an API error", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    render(<AccountScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your details.");
  });

  it("does not update after it is gone", async () => {
    let resolve: (user: User) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise<User>((r) => (resolve = r)));
    const { unmount } = render(<AccountScreen />);
    unmount();
    resolve(alice);
    await Promise.resolve();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
  });

  it("ignores a failure that arrives after it is gone", async () => {
    let reject: (error: Error) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise<User>((_, r) => (reject = r)));
    const { unmount } = render(<AccountScreen />);
    unmount();
    reject(new Error("late"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AccountScreen: renaming", () => {
  it("saves the trimmed name, confirms, and refreshes the session", async () => {
    const user = userEvent.setup();
    const input = await loaded();
    apiFetch.mockResolvedValueOnce({ ...alice, name: "Alice Tan" });

    await user.clear(input);
    await user.type(input, "  Alice Tan ");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Name saved.");
    expect(apiFetch).toHaveBeenLastCalledWith("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ name: "Alice Tan" }),
    });
    expect(update).toHaveBeenCalledWith({ name: "Alice Tan" });
    expect(input).toHaveValue("Alice Tan");
  });

  it("drops the saved note once the name is edited again", async () => {
    const user = userEvent.setup();
    const input = await loaded();
    apiFetch.mockResolvedValueOnce(alice);
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByRole("status");

    await user.type(input, "x");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still reports success when the session cannot be refreshed", async () => {
    const user = userEvent.setup();
    await loaded();
    update.mockRejectedValue(new Error("offline"));
    apiFetch.mockResolvedValueOnce(alice);

    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("refuses a blank name without asking the server", async () => {
    const user = userEvent.setup();
    const input = await loaded();
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your name.");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps what was typed when the save fails", async () => {
    const user = userEvent.setup();
    const input = await loaded();
    apiFetch.mockRejectedValueOnce(new ApiRequestError(500, undefined));

    await user.clear(input);
    await user.type(input, "Alicia");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveValue("Alicia");
    expect(update).not.toHaveBeenCalled();
  });

  it("uses a generic message for a failure that is not an API error", async () => {
    const user = userEvent.setup();
    await loaded();
    apiFetch.mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your name.");
  });

  it("disables the button while saving", async () => {
    const user = userEvent.setup();
    await loaded();
    let finish: (value: User) => void = () => undefined;
    apiFetch.mockReturnValueOnce(new Promise<User>((r) => (finish = r)));

    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    finish(alice);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
    });
  });

  it("puts the save button above the bottom nav and tall enough to tap", async () => {
    await loaded();
    const button = screen.getByRole("button", { name: "Save name" });
    expect(button.className).toContain("min-h-12");
    expect(button.parentElement?.className).toContain("sticky above-nav");
  });
});

describe("AccountScreen: signing out", () => {
  it("signs straight out when nothing is waiting to sync", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOutAndForget).toHaveBeenCalledWith(signOut);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("warns first when records are waiting, and signs out only on confirmation", async () => {
    const user = userEvent.setup();
    hasUnsynced.mockResolvedValue(true);
    await loaded();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("wait here until you sign in again");
    expect(signOutAndForget).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign out anyway" }));
    expect(signOutAndForget).toHaveBeenCalledOnce();
  });

  it("stays signed in when the member keeps things as they are", async () => {
    const user = userEvent.setup();
    hasUnsynced.mockResolvedValue(true);
    await loaded();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Keep as it is" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(signOutAndForget).not.toHaveBeenCalled();
  });

  it("shows the sign-out as pending", async () => {
    const user = userEvent.setup();
    await loaded();
    signOutAndForget.mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Signing out…" })).toBeDisabled();
  });

  it("reports a failed sign-out and lets the member try again", async () => {
    const user = userEvent.setup();
    hasUnsynced.mockResolvedValue(true);
    await loaded();
    signOutAndForget.mockRejectedValueOnce(new Error("offline"));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Sign out anyway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
