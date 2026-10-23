import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveFollowUpSheet } from "@/components/follow-ups/remove-follow-up-sheet";
import type { FollowUp } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const note = (over: Partial<FollowUp> = {}): FollowUp => ({
  id: "f1",
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "suggested",
  author: { id: "u1", name: "Ann Tan", image: null },
  note: "Asked us back.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue(undefined);
  useOnline.mockReturnValue(true);
});

describe("an admin dismissing a suggestion", () => {
  it("says the author will be told, and sends the reason with the removal", async () => {
    const onRemoved = vi.fn();
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={onRemoved} />);
    const sheet = within(screen.getByRole("dialog", { name: "Dismiss this suggestion?" }));
    expect(sheet.getByText("Ann will be told it was not added.")).toBeVisible();
    expect(sheet.getByLabelText("Reason (optional)")).toHaveAccessibleDescription(
      "Ann will see this.",
    );
    fireEvent.change(sheet.getByLabelText("Reason (optional)"), {
      target: { value: "  Visited last week & moved  " },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Dismiss suggestion" }));
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith(
      `/follow-ups/f1?reason=${encodeURIComponent("Visited last week & moved")}`,
      { method: "DELETE" },
    );
  });

  it("sends no reason when none is given", async () => {
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", { method: "DELETE" });
    });
  });

  it("sends one request on a double tap", async () => {
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={vi.fn()} />);
    const remove = screen.getByRole("button", { name: "Dismiss suggestion" });
    act(() => {
      fireEvent.click(remove);
      fireEvent.click(remove);
    });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses a reason past the limit before asking the server", () => {
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "x".repeat(501) },
    });
    expect(screen.getByLabelText("Reason (optional)")).toHaveAccessibleDescription(
      "Keep the reason to 500 characters.",
    );
    expect(screen.getByRole("button", { name: "Dismiss suggestion" })).toBeDisabled();
  });

  it("keeps the reason and says why when the removal fails", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(404, { error: { code: "not_found", message: "raw" } }),
    );
    const onRemoved = vi.fn();
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={onRemoved} />);
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That note or unit is no longer there.",
    );
    expect(screen.getByLabelText("Reason (optional)")).toHaveValue("Moved");
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("closes on Keep it without a request", () => {
    const onClose = vi.fn();
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={onClose} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onClose).toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("is disabled offline and says why", () => {
    useOnline.mockReturnValue(false);
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={vi.fn()} onRemoved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Dismiss suggestion" })).toBeDisabled();
    expect(screen.getByText("Connect to change follow-ups")).toBeVisible();
  });
});

describe("an admin removing a listed note", () => {
  it("says where it can still be found", async () => {
    render(
      <RemoveFollowUpSheet
        note={note({ status: "listed" })}
        isAdmin
        onClose={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    const sheet = within(screen.getByRole("dialog", { name: "Remove from the follow-up list?" }));
    expect(
      sheet.getByText(
        "It stops showing on the list and in sessions. Admins can still see it under Dismissed.",
      ),
    ).toBeVisible();
    expect(sheet.getByLabelText("Reason (optional)")).toHaveAccessibleDescription(
      "Admins see this under Dismissed.",
    );
    fireEvent.click(sheet.getByRole("button", { name: "Remove from list" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", { method: "DELETE" });
    });
  });
});

describe("a member withdrawing their own suggestion", () => {
  it("asks once, with no reason to give, and withdraws on confirm", async () => {
    const onRemoved = vi.fn();
    render(
      <RemoveFollowUpSheet note={note()} isAdmin={false} onClose={vi.fn()} onRemoved={onRemoved} />,
    );
    const ask = within(screen.getByRole("alertdialog", { name: "Withdraw your suggestion?" }));
    expect(ask.getByText("Admins will no longer see it for review.")).toBeVisible();
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull();
    fireEvent.click(ask.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", { method: "DELETE" });
  });

  it("says why a withdrawal failed, in place of the question's detail", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <RemoveFollowUpSheet note={note()} isAdmin={false} onClose={vi.fn()} onRemoved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(
      await screen.findByText("Could not confirm. Refresh to see whether it went through."),
    ).toBeVisible();
  });
});
