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
  waitingSuggestionBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue(undefined);
  useOnline.mockReturnValue(true);
});

const dialog = (name: string) => within(screen.getByRole("dialog", { name }));
const write = (sheet: ReturnType<typeof dialog>, label: string, value: string) => {
  fireEvent.change(sheet.getByLabelText(label), { target: { value } });
};

describe("an admin dismissing a suggestion", () => {
  const open = (onRemoved = vi.fn()) => {
    render(
      <RemoveFollowUpSheet
        note={note()}
        isAdmin
        viewerId="admin"
        onClose={vi.fn()}
        onRemoved={onRemoved}
      />,
    );
    return dialog("Dismiss this suggestion?");
  };

  it("says the author will be told why, and asks for the reason", () => {
    const sheet = open();
    expect(sheet.getByText("Ann will be told it was not added, with your reason.")).toBeVisible();
    const field = sheet.getByLabelText("Why not add it?");
    expect(field).toHaveAttribute("placeholder", "For example: we visited last week");
    expect(field).toHaveAccessibleDescription(
      "Write a reason to continue. Ann and admins will see it.",
    );
  });

  it("stays disabled until a reason is written, spaces not counting", () => {
    const sheet = open();
    const button = sheet.getByRole("button", { name: "Dismiss suggestion" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Write a reason to continue. Ann and admins will see it.",
    );
    write(sheet, "Why not add it?", "   ");
    expect(button).toBeDisabled();
    write(sheet, "Why not add it?", "We visited last week");
    expect(button).toBeEnabled();
    expect(sheet.getByLabelText("Why not add it?")).toHaveAccessibleDescription(
      "Ann and admins will see it.",
    );
  });

  it("sends the reason, trimmed, in the body and never the address", async () => {
    const onRemoved = vi.fn();
    const sheet = open(onRemoved);
    write(sheet, "Why not add it?", "  Visited last week & moved  ");
    fireEvent.click(sheet.getByRole("button", { name: "Dismiss suggestion" }));
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1/remove", {
      method: "POST",
      body: JSON.stringify({ reason: "Visited last week & moved" }),
    });
  });

  it("sends one request on a double tap", async () => {
    const onRemoved = vi.fn();
    const sheet = open(onRemoved);
    write(sheet, "Why not add it?", "Moved");
    const button = sheet.getByRole("button", { name: "Dismiss suggestion" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledTimes(1);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a reason past the limit before asking the server", () => {
    const sheet = open();
    write(sheet, "Why not add it?", "x".repeat(501));
    const field = sheet.getByLabelText("Why not add it?");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Keep the reason to 500 characters.");
    expect(sheet.getByRole("button", { name: "Dismiss suggestion" })).toBeDisabled();
  });

  it("keeps the reason and says why when the removal fails", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(404, { error: { code: "not_found", message: "raw" } }),
    );
    const onRemoved = vi.fn();
    const sheet = open(onRemoved);
    write(sheet, "Why not add it?", "Moved away");
    fireEvent.click(sheet.getByRole("button", { name: "Dismiss suggestion" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "That note or unit is no longer there. Refresh to see the latest.",
    );
    expect(sheet.getByLabelText("Why not add it?")).toHaveValue("Moved away");
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("asks before a stray tap throws a written reason away", () => {
    const onClose = vi.fn();
    render(<RemoveFollowUpSheet note={note()} isAdmin onClose={onClose} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    write(dialog("Dismiss this suggestion?"), "Why not add it?", "Moved");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("alertdialog", { name: "Discard this reason?" })).toHaveTextContent(
      "Nothing has been removed.",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is disabled offline and says why", () => {
    useOnline.mockReturnValue(false);
    const sheet = open();
    write(sheet, "Why not add it?", "Moved");
    expect(sheet.getByRole("button", { name: "Dismiss suggestion" })).toBeDisabled();
    expect(sheet.getByText("Connect to change follow-ups")).toBeVisible();
  });
});

describe("an admin removing a listed note", () => {
  it("says the member who wrote it will read the reason too", () => {
    render(
      <RemoveFollowUpSheet
        note={note({ status: "listed" })}
        isAdmin
        viewerId="admin"
        onClose={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    const sheet = dialog("Remove from the follow-up list?");
    // The title keeps the word whole: "follow-" over "up" read as two (#196).
    expect(sheet.getByText("follow-up")).toHaveClass("whole-word");
    expect(
      sheet.getByText(
        "It leaves the list and every follow-up session's list. Ann will be told, with your reason.",
      ),
    ).toBeVisible();
    expect(sheet.getByLabelText("Why take it off the list?")).toHaveAttribute(
      "placeholder",
      "For example: the family has moved",
    );
    write(sheet, "Why take it off the list?", "Moved");
    expect(sheet.getByLabelText("Why take it off the list?")).toHaveAccessibleDescription(
      "Ann and admins will see it.",
    );
    expect(sheet.getByRole("button", { name: "Remove from list" })).toBeEnabled();
  });

  it("says where its own note can still be found", () => {
    render(
      <RemoveFollowUpSheet
        note={note({ status: "listed", author: { id: "admin", name: "Admin", image: null } })}
        isAdmin
        viewerId="admin"
        onClose={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    const sheet = dialog("Remove from the follow-up list?");
    expect(
      sheet.getByText(
        "It leaves the list and every follow-up session's list. Admins can still see it under Dismissed.",
      ),
    ).toBeVisible();
    expect(sheet.getByLabelText("Why take it off the list?")).toHaveAccessibleDescription(
      "Write a reason to continue. Admins will see it under Dismissed.",
    );
  });
});

describe("a member withdrawing their own suggestion", () => {
  const open = (onRemoved = vi.fn()) => {
    render(
      <RemoveFollowUpSheet
        note={note()}
        isAdmin={false}
        viewerId="u1"
        onClose={vi.fn()}
        onRemoved={onRemoved}
      />,
    );
    return dialog("Withdraw your suggestion?");
  };

  it("asks why, like every removal, and says only admins will read it", async () => {
    const onRemoved = vi.fn();
    const sheet = open(onRemoved);
    expect(sheet.getByText("Admins will no longer see it for review.")).toBeVisible();
    const field = sheet.getByLabelText("Why withdraw it?");
    expect(field).toHaveAttribute("placeholder", "For example: I picked the wrong unit");
    expect(sheet.getByRole("button", { name: "Withdraw suggestion" })).toBeDisabled();

    write(sheet, "Why withdraw it?", "Wrong unit");
    expect(field).toHaveAccessibleDescription("Admins will see it under Dismissed.");
    fireEvent.click(sheet.getByRole("button", { name: "Withdraw suggestion" }));
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1/remove", {
      method: "POST",
      body: JSON.stringify({ reason: "Wrong unit" }),
    });
  });

  it("is a sheet over the bottom nav", () => {
    open();
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
  });

  it("says why a withdrawal failed", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "raw" } }),
    );
    const sheet = open();
    write(sheet, "Why withdraw it?", "Wrong unit");
    fireEvent.click(sheet.getByRole("button", { name: "Withdraw suggestion" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "Only the person who wrote this, or an admin, can change it.",
    );
  });
});
