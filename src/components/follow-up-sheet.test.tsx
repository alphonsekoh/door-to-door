import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowUpSheet, diffFollowUp } from "@/components/follow-up-sheet";
import type { FollowUp } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { dueDayToInstant } from "@/lib/follow-ups";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/use-online", () => ({ useOnline }));

const existing: FollowUp = {
  id: "f1",
  householdId: "h1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  author: { id: "u1", name: "Alice", image: null },
  note: "Bring the flyer.",
  dueDate: dueDayToInstant("2026-11-01"),
  doneAt: null,
  doneBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const create = { kind: "create", householdId: "h1", visitId: null, unitNumber: "#05-123" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({});
  useOnline.mockReturnValue(true);
});

const sheet = () => within(screen.getByRole("dialog"));
const type = (label: string, value: string) => {
  fireEvent.change(sheet().getByLabelText(label), { target: { value } });
};

describe("adding a note", () => {
  it("sends a blank due date as null, never an empty string", async () => {
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    type("Note", "  Call back  ");
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
      method: "POST",
      body: JSON.stringify({ householdId: "h1", visitId: null, note: "Call back", dueDate: null }),
    });
  });

  it("sends a due day as the start of that day", async () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "Call back");
    type("Due (optional)", "2026-12-24");
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    const body = JSON.parse((apiFetch.mock.calls[0]?.[1] as { body: string }).body) as {
      dueDate: string;
    };
    expect(body.dueDate).toBe(new Date(2026, 11, 24).toISOString());
  });

  it("sends one request on a double tap", async () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "Call back");
    const save = sheet().getByRole("button", { name: "Save follow-up" });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses an empty note without a request", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "   ");
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    // Under the field it is about, not in the failure banner.
    const note = sheet().getByLabelText("Note");
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveAccessibleDescription("Write the note first.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears the note's error as soon as the note is fixed", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    expect(sheet().getByText("Write the note first.")).toBeInTheDocument();

    type("Note", "Call back");
    expect(sheet().queryByText("Write the note first.")).toBeNull();
    expect(sheet().getByLabelText("Note")).toHaveAttribute("aria-invalid", "false");
  });

  it("does not raise the error while a note is being typed", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "   ");
    expect(sheet().queryByText("Write the note first.")).toBeNull();
  });

  it("counts characters and refuses past the limit", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "x".repeat(2001));
    expect(screen.getByText("2001 of 2000")).toBeInTheDocument();
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    expect(sheet().getByLabelText("Note")).toHaveAccessibleDescription(
      "Keep the note to 2000 characters.",
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the save fails", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    type("Note", "Call back");
    fireEvent.click(sheet().getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm. Refresh to see whether it went through.",
    );
    expect(sheet().getByLabelText("Note")).toHaveValue("Call back");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("is disabled offline and says why", () => {
    useOnline.mockReturnValue(false);
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(sheet().getByRole("button", { name: "Save follow-up" })).toBeDisabled();
    expect(screen.getByText("Connect to change follow-ups")).toBeInTheDocument();
  });

  it("sits above the bottom nav, with its confirm above it", () => {
    render(
      <FollowUpSheet mode={{ kind: "edit", note: existing }} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
    expect(screen.getByRole("alertdialog").parentElement).toHaveClass("z-60");
  });

  it("is rendered outside any form it was opened from", () => {
    render(
      <form aria-label="Visit">
        <FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />
      </form>,
    );
    expect(screen.getByRole("dialog").closest("form")).toBeNull();
  });
});

describe("editing a note", () => {
  const edit = { kind: "edit", note: existing } as const;

  it("starts from what is there", () => {
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(sheet().getByLabelText("Note")).toHaveValue("Bring the flyer.");
    expect(sheet().getByLabelText("Due (optional)")).toHaveValue("2026-11-01");
  });

  it("sends only what moved", async () => {
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Due (optional)", "");
    fireEvent.click(sheet().getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", {
        method: "PATCH",
        body: JSON.stringify({ dueDate: null }),
      });
    });
  });

  it("closes without a request when nothing changed", () => {
    const onClose = vi.fn();
    render(<FollowUpSheet mode={edit} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(sheet().getByRole("button", { name: "Save changes" }));
    expect(onClose).toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("words a refusal for someone else's note", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "raw" } }),
    );
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Note", "Changed");
    fireEvent.click(sheet().getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the person who wrote this note, or an admin, can change it.",
    );
    expect(sheet().getByLabelText("Note")).toHaveValue("Changed");
  });

  it("asks before deleting, and deletes on confirm", async () => {
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(apiFetch).not.toHaveBeenCalled();

    const confirm = within(screen.getByRole("alertdialog", { name: "Delete this follow-up?" }));
    fireEvent.click(confirm.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", { method: "DELETE" });
  });

  it("keeps the note when deleting is cancelled", async () => {
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as it is" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lets Escape close only the confirm, then the sheet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FollowUpSheet mode={edit} onClose={onClose} onSaved={vi.fn()} />);
    const remove = screen.getByRole("button", { name: "Delete this note" });
    await user.click(remove);
    const keep = screen.getByRole("button", { name: "Keep as it is" });
    expect(keep).toHaveFocus();
    expect(
      screen.getByRole("dialog", { name: "Edit follow-up" }).closest("[inert]"),
    ).not.toBeNull();

    await user.keyboard("{Escape}");
    // Focus is back as the confirm starts to leave, not once it has gone.
    expect(remove).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows why a delete failed", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(404, { error: { code: "not_found", message: "raw" } }),
    );
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That note or unit is no longer there.",
    );
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});

describe("diffFollowUp", () => {
  it("is empty when nothing moved, ignoring surrounding spaces", () => {
    expect(diffFollowUp(existing, " Bring the flyer. ", "2026-11-01")).toEqual({});
  });

  it("carries the new text and the new day", () => {
    expect(diffFollowUp(existing, "New", "2026-11-02")).toEqual({
      note: "New",
      dueDate: dueDayToInstant("2026-11-02"),
    });
  });
});
