import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionActionButton } from "@/components/sessions/session-action-button";
import type * as ApiClientModule from "@/lib/api-client";
import { availableActions } from "@/lib/sessions";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const start = availableActions("draft")[0];
const end = availableActions("active")[0];
const reopen = availableActions("ended")[0];

if (!start || !end || !reopen) {
  throw new Error("every status must offer an action");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionActionButton", () => {
  it("keeps the ordinary look for starting and reopening", () => {
    render(<SessionActionButton sessionId="s1" spec={start} onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start session" })).toHaveClass("btn-primary");
  });

  it("starts without asking, since nothing is lost", async () => {
    const onDone = vi.fn();
    apiFetch.mockResolvedValue({ id: "s1" });
    render(<SessionActionButton sessionId="s1" spec={start} onDone={onDone} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/start", { method: "POST" });
  });

  it("reopens without asking, because that is the recovery path", async () => {
    // An admin racing to unlock a member mid-amendment must not meet a dialog.
    apiFetch.mockResolvedValue({ id: "s1" });
    render(<SessionActionButton sessionId="s1" spec={reopen} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Reopen session" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/reopen", { method: "POST" });
    });
  });

  it("looks like it takes something away, and its confirm does too", async () => {
    const user = userEvent.setup();
    render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);
    const button = screen.getByRole("button", { name: "End session" });
    expect(button).toHaveClass("btn-danger-outline");
    await user.click(button);
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
    ).toHaveClass("btn-danger");
  });

  it("asks before ending, and does nothing until confirmed", async () => {
    const user = userEvent.setup();
    render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("ends once confirmed", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    apiFetch.mockResolvedValue({ id: "s1" });
    render(<SessionActionButton sessionId="s1" spec={end} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
    );

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/end", { method: "POST" });
  });

  it("leaves the outing alone when the admin backs out", async () => {
    const user = userEvent.setup();
    render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(screen.getByRole("button", { name: "Keep as it is" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the server's own refusal when a second outing is started", async () => {
    // The message says how to clear the clash; a generic apology would not.
    const clash =
      "Another session is already active. End it before starting or reopening this one.";
    apiFetch.mockRejectedValue(new Error(clash));
    render(<SessionActionButton sessionId="s2" spec={start} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(clash);
  });

  it("does not report success when the action failed", async () => {
    const onDone = vi.fn();
    apiFetch.mockRejectedValue(new Error("nope"));
    render(<SessionActionButton sessionId="s1" spec={start} onDone={onDone} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("alert");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<SessionActionButton sessionId="s1" spec={start} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not do that.");
  });

  it("closes the dialog when the confirmed action fails, so the error is readable", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("nope"));
    render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
