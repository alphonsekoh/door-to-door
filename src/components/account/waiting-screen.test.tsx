import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaitingScreen, type WaitingAccount } from "@/components/account/waiting-screen";
import type * as ApiClientModule from "@/lib/api-client";
import { nextFrame } from "../../../test/next-frame";

const { apiFetch, update, signOut, signOutAndForget, reloadPage } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  update: vi.fn(),
  signOut: vi.fn(),
  signOutAndForget: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ update }), signOut }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole: () => ({ userId: "u1" }) }));
vi.mock("@/lib/session/sign-out", () => ({ signOutAndForget }));
vi.mock("@/lib/session/navigate", () => ({ reloadPage }));
vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof ApiClientModule>("@/lib/api-client")),
  apiFetch,
}));

const { ApiRequestError } = await import("@/lib/api-client");

const pending: WaitingAccount = { email: "pat@gmail.com", name: "Pat", approval: "pending" };
const blocked: WaitingAccount = { ...pending, approval: "blocked" };

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(undefined);
  signOutAndForget.mockResolvedValue(undefined);
});

describe("WaitingScreen, waiting for approval (#249)", () => {
  it("names the address waiting, and says no new sign-in is needed", () => {
    render(<WaitingScreen account={pending} />);
    expect(
      screen.getByText(/An admin needs to approve pat@gmail\.com before you can use Door to Door/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Check again takes you in/)).toBeInTheDocument();
  });

  it("offers the name Google gave, to correct", () => {
    render(<WaitingScreen account={pending} />);
    expect(screen.getByLabelText("Your name")).toHaveValue("Pat");
  });

  it("starts empty when Google gave no name, and says the address when it is unknown", () => {
    render(<WaitingScreen account={{ ...pending, name: null, email: null }} />);
    expect(screen.getByLabelText("Your name")).toHaveValue("");
    expect(screen.getByText(/approve this account before/)).toBeInTheDocument();
  });

  it("saves a corrected name, and carries it into the session", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ name: "Pat Tan" });
    render(<WaitingScreen account={pending} />);

    await user.clear(screen.getByLabelText("Your name"));
    await user.type(screen.getByLabelText("Your name"), "  Pat Tan ");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Name saved.");
    expect(apiFetch).toHaveBeenCalledWith("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ name: "Pat Tan" }),
    });
    expect(screen.getByLabelText("Your name")).toHaveValue("Pat Tan");
    expect(update).toHaveBeenCalledWith({ name: "Pat Tan" });

    await user.type(screen.getByLabelText("Your name"), "!");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the save when the session cannot take the new name, and an empty name from the server", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ name: null });
    update.mockRejectedValue(new Error("offline"));
    render(<WaitingScreen account={pending} />);
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Name saved.");
    expect(screen.getByLabelText("Your name")).toHaveValue("");
  });

  it("refuses a name it could not keep, before asking the server", async () => {
    const user = userEvent.setup();
    render(<WaitingScreen account={pending} />);
    await user.clear(screen.getByLabelText("Your name"));
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("says the server's refusal, or its own line with no answer, and gives focus back", async () => {
    const user = userEvent.setup();
    let refuse: (reason: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    render(<WaitingScreen account={pending} />);
    const save = screen.getByRole("button", { name: "Save name" });
    await user.click(save);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await nextFrame();

    refuse(new TypeError("Failed to fetch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your name.");
    expect(save).toHaveFocus();

    apiFetch.mockRejectedValueOnce(
      new ApiRequestError(400, {
        error: { code: "validation_failed", message: "Your name needs at least one letter." },
      }),
    );
    await user.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your name needs at least one letter.",
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("draws the page again when the request was rejected meanwhile, to say so", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, {
        error: { code: "account_blocked", message: "This account's request wasn't approved." },
      }),
    );
    render(<WaitingScreen account={pending} />);
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => {
      expect(reloadPage).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("checks again by drawing the page afresh", async () => {
    const user = userEvent.setup();
    render(<WaitingScreen account={pending} />);
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it("signs out, clearing what the phone holds", async () => {
    const user = userEvent.setup();
    render(<WaitingScreen account={pending} />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAndForget).toHaveBeenCalledWith(signOut, "u1");
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
  });
});

describe("WaitingScreen, rejected (#249)", () => {
  it("says the request was not approved, and offers only Sign out", () => {
    render(<WaitingScreen account={blocked} />);
    expect(screen.getByText(/An admin didn't approve pat@gmail\.com/)).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Sign out"]);
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
  });

  it("says a sign-out that failed in view, and lets it be tried again", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const user = userEvent.setup();
      signOutAndForget.mockRejectedValueOnce(new Error("offline"));
      render(<WaitingScreen account={blocked} />);
      const button = screen.getByRole("button", { name: "Sign out" });
      await user.click(button);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not sign out. Check your connection and try again.");
      expect(alert.parentElement).toHaveClass("scroll-clear-nav");
      expect(scrolled.mock.contexts).toEqual([alert.parentElement]);
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent("Sign out");
    } finally {
      scrolled.mockRestore();
    }
  });
});
