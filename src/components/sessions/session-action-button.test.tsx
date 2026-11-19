import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionActionButton } from "@/components/sessions/session-action-button";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { availableActions } from "@/lib/session/sessions";

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

  it("is not offered while the server would refuse it, and says why beside it", async () => {
    render(
      <SessionActionButton
        sessionId="s1"
        spec={start}
        blocked="Add households to start it."
        onDone={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Start session" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Add households to start it.");
    await userEvent.setup().click(button);
    expect(apiFetch).not.toHaveBeenCalled();
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
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "session_already_active", message: clash } }),
    );
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

  /* On the list a failure is drawn under the row, and near the foot of the
     screen it landed under the nav (#213). jsdom lays nothing out: the
     verifier measures on both phones. */
  describe("a failure, brought into view", () => {
    it("brings the failure into view with the button as it is drawn, leaving focus where it was", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const user = userEvent.setup();
        render(<SessionActionButton sessionId="s1" spec={start} onDone={vi.fn()} />);
        // The list and a session open where they are, not scrolled to a button.
        expect(scrolled).not.toHaveBeenCalled();
        const button = screen.getByRole("button", { name: "Start session" });
        await user.click(button);

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Could not do that.");
        const both = alert.parentElement;
        expect(both).toContainElement(button);
        /* Clear of the nav and a floating banner, and no further: no Save
           bar docks on the Sessions list or a session's page. */
        expect(both).toHaveClass("scroll-clear-nav");
        expect(both).not.toHaveClass("scroll-clear-chrome");
        expect(scrolled.mock.contexts).toEqual([both]);
        expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
        expect(button).toHaveFocus();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("brings a failed End into view once its confirm has closed", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockRejectedValue(
          new ApiRequestError(409, { error: { code: "conflict", message: "Already ended." } }),
        );
        render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "End session" }));
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
        );

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Already ended.");
        const both = alert.parentElement;
        expect(both).toContainElement(screen.getByRole("button", { name: "End session" }));
        expect(both).toHaveClass("scroll-clear-nav");
        expect(scrolled.mock.contexts).toContain(both);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("scrolls nothing when the action works", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const onDone = vi.fn();
        apiFetch.mockResolvedValue({ id: "s1" });
        render(<SessionActionButton sessionId="s1" spec={start} onDone={onDone} />);
        await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
        await waitFor(() => {
          expect(onDone).toHaveBeenCalled();
        });
        expect(scrolled).not.toHaveBeenCalled();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("leaves the page where it is as a second try clears the failure", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        render(<SessionActionButton sessionId="s1" spec={start} onDone={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Start session" }));
        await screen.findByRole("alert");
        expect(scrolled).toHaveBeenCalledOnce();

        // The button is under the thumb that just pressed it again.
        apiFetch.mockReturnValue(new Promise(() => undefined));
        await user.click(screen.getByRole("button", { name: "Start session" }));
        await screen.findByRole("button", { name: "Working…" });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(scrolled).toHaveBeenCalledOnce();
      } finally {
        scrolled.mockRestore();
      }
    });

    it("brings the failure into view again when a second try fails too", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        const user = userEvent.setup();
        apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        render(<SessionActionButton sessionId="s1" spec={start} onDone={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Start session" }));
        await screen.findByRole("alert");
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
        });

        await user.click(screen.getByRole("button", { name: "Start session" }));
        await waitFor(() => {
          expect(scrolled).toHaveBeenCalledTimes(2);
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Could not do that.");
      } finally {
        scrolled.mockRestore();
      }
    });

    it("lays out what it is given before the button, in the block it brings into view", async () => {
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
      try {
        apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        render(
          <SessionActionButton
            sessionId="s1"
            spec={start}
            primary={false}
            onDone={vi.fn()}
            className="flex flex-wrap"
          >
            <span>June outing</span>
          </SessionActionButton>,
        );
        const title = screen.getByText("June outing");
        const button = screen.getByRole("button", { name: "Start session" });
        const block = button.parentElement;
        expect(block).toHaveClass("scroll-clear-nav", "flex", "flex-wrap");
        expect(title.nextElementSibling).toBe(button);

        await userEvent.setup().click(button);
        const alert = await screen.findByRole("alert");
        // Under both, a row of its own.
        expect(button.nextElementSibling).toBe(alert);
        expect(alert).toHaveClass("basis-full");
        expect(scrolled.mock.contexts).toEqual([block]);
      } finally {
        scrolled.mockRestore();
      }
    });
  });

  it("closes the dialog when the confirmed action fails, so the error is readable", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SessionActionButton sessionId="s1" spec={end} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }),
    );

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not do that.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
