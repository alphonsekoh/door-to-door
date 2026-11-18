import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowUpSheet, diffFollowUp } from "@/components/follow-ups/follow-up-sheet";
import type { FollowUp } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { dueDayToInstant } from "@/lib/history/follow-ups";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
const asAdmin = () => useRole.mockReturnValue({ userId: "admin", isAdmin: true });

const existing: FollowUp = {
  id: "f1",
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "listed",
  author: { id: "u1", name: "Alice", image: null },
  note: "Bring the flyer.",
  dueDate: dueDayToInstant("2026-11-01"),
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  waitingSuggestionBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const create = { kind: "create", householdId: "h1", visitId: null, unitNumber: "#05-123" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({});
  useOnline.mockReturnValue(true);
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
});

/* A member's words: why the household is worth a return visit. */
const WHY = "Why should we go back?";
/* An admin's, and any listed note's: what the next visit should do. */
const WHAT = "What should the next visit do?";

const sheet = () => within(screen.getByRole("dialog"));
const notSaved = () => within(screen.getByRole("alertdialog", { name: "Not saved" }));
const reasons = () =>
  notSaved()
    .getAllByRole("listitem")
    .map((item) => item.textContent);
const invalid = (path: string, message = "Invalid string: must match pattern /\\S/") =>
  new ApiRequestError(400, {
    error: {
      code: "validation_failed",
      message: "Invalid request body.",
      details: [{ path, message }],
    },
  });
const type = (label: string, value: string) => {
  fireEvent.change(sheet().getByLabelText(label), { target: { value } });
};

describe("a member suggesting a return visit", () => {
  it("says an admin reviews it, and names the unit", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Suggest a return visit, #05-123" });
    expect(dialog).toHaveTextContent(
      "An admin reviews every suggestion and decides whether to add it to the follow-up list.",
    );
    expect(sheet().getByLabelText(WHY)).toHaveAttribute(
      "placeholder",
      "For example: asked us to come back after 7pm",
    );
    expect(sheet().getByLabelText("Go back by (optional)")).toBeInTheDocument();
  });

  it("sends a blank due date as null, never an empty string", async () => {
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    type(WHY, "  Call back  ");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
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
    type(WHY, "Call back");
    type("Go back by (optional)", "2026-12-24");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
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
    type(WHY, "Call back");
    const save = sheet().getByRole("button", { name: "Send suggestion" });
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
    type(WHY, "   ");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    // Under the field it is about, not in the failure banner.
    const note = sheet().getByLabelText(WHY);
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveAccessibleDescription("Write the note first.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears the note's error as soon as the note is fixed", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    fireEvent.click(notSaved().getByRole("button", { name: "OK" }));
    expect(sheet().getByText("Write the note first.")).toBeInTheDocument();

    type(WHY, "Call back");
    expect(sheet().queryByText("Write the note first.")).toBeNull();
    expect(sheet().getByLabelText(WHY)).toHaveAttribute("aria-invalid", "false");
  });

  it("does not raise the error while a note is being typed", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, "   ");
    expect(sheet().queryByText("Write the note first.")).toBeNull();
  });

  it("counts characters and refuses past the limit", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, "x".repeat(2001));
    expect(screen.getByText("2001 of 2000")).toBeInTheDocument();
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    expect(sheet().getByLabelText(WHY)).toHaveAccessibleDescription(
      "Keep the note to 2000 characters.",
    );
    // Not blank: the count and the field's error say enough (#119).
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the save fails", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    type(WHY, "Call back");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm. Refresh to see whether it went through.",
    );
    expect(sheet().getByLabelText(WHY)).toHaveValue("Call back");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says plainly when the household is already listed or suggested", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "follow_up_exists", message: "raw" } }),
    );
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, "Call back");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This household is already on the follow-up list or has a suggestion waiting.",
    );
    expect(sheet().getByLabelText(WHY)).toHaveValue("Call back");
  });

  it("is disabled offline and says why", () => {
    useOnline.mockReturnValue(false);
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(sheet().getByRole("button", { name: "Send suggestion" })).toBeDisabled();
    expect(screen.getByText("Connect to change follow-ups")).toBeInTheDocument();
  });

  it("sits above the bottom nav", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
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

/* A follow-up session as the lookup returns it. */
const SESSION = {
  id: "s1",
  title: "Saturday revisits",
  kind: "follow_up",
  status: "active",
  startedAt: "2026-10-20T09:00:00.000Z",
  endedAt: null,
  createdBy: { id: "admin", name: "Admin", image: null },
  createdAt: "2026-10-20T08:00:00.000Z",
};

/* The sessions the lookup finds, and what the two writes answer. */
function server({
  running = [] as unknown[],
  drafts = [] as unknown[],
  lookup = true,
  addToSession = () => Promise.resolve({}),
}: {
  running?: unknown[];
  drafts?: unknown[];
  lookup?: boolean;
  addToSession?: () => Promise<unknown>;
} = {}) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions?")) {
      if (!lookup) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ data: path.includes("status=active") ? running : drafts });
    }
    if (path === "/sessions/s1/households") return addToSession();
    return Promise.resolve({});
  });
}

const writes = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST")
    .map(([path, init]): [string, unknown] => [
      String(path),
      JSON.parse((init as { body: string }).body) as unknown,
    ]);

describe("an admin adding to the follow-up list", () => {
  const addButton = () => sheet().getByRole("button", { name: "Add to list" });

  it("speaks of the list, not of a suggestion", async () => {
    asAdmin();
    server();
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    expect(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    ).not.toHaveTextContent("An admin reviews");
    expect(sheet().getByText("follow-up")).toHaveClass("whitespace-nowrap");
    type(WHAT, "Bring the flyer");
    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    fireEvent.click(addButton());
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Added to the follow-up list.");
    });
  });

  it("says why the household is here above an empty note, not in it", () => {
    asAdmin();
    server();
    render(
      <FollowUpSheet
        mode={{ ...create, context: "Showed high interest on 3 Mar 2026." }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(sheet().getByText("Showed high interest on 3 Mar 2026.")).toBeVisible();
    expect(sheet().getByLabelText(WHAT)).toHaveValue("");
  });

  it("waits to learn which follow-up session it could also go into", () => {
    asAdmin();
    apiFetch.mockReturnValue(new Promise(() => undefined));
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(sheet().getByRole("status")).toHaveTextContent("Looking for a follow-up session…");
    type(WHAT, "Bring the flyer");
    expect(addButton()).toBeDisabled();
  });

  it("offers the running follow-up session, ticked, and adds the door to it too", async () => {
    asAdmin();
    server({ running: [SESSION], drafts: [{ ...SESSION, id: "s2", status: "draft" }] });
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    const box = await sheet().findByRole("checkbox", { name: "Also add to Saturday revisits" });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription("Running now. Members will see it on their list.");

    type(WHAT, "Bring the flyer");
    fireEvent.click(addButton());
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Added to the follow-up list and to Saturday revisits.");
    });
    expect(writes()).toEqual([
      ["/follow-ups", { householdId: "h1", visitId: null, note: "Bring the flyer", dueDate: null }],
      ["/sessions/s1/households", { householdIds: ["h1"] }],
    ]);
  });

  it("offers a follow-up session that has not started when none is running", async () => {
    asAdmin();
    server({ drafts: [{ ...SESSION, status: "draft" }] });
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(
      await sheet().findByRole("checkbox", { name: "Also add to Saturday revisits" }),
    ).toHaveAccessibleDescription("A follow-up session that hasn't started yet.");
  });

  it("adds to the list alone once the box is unticked", async () => {
    asAdmin();
    server({ running: [SESSION] });
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(await sheet().findByRole("checkbox", { name: /Also add to/ }));
    type(WHAT, "Bring the flyer");
    fireEvent.click(addButton());
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Added to the follow-up list.");
    });
    expect(writes().map(([path]) => path)).toEqual(["/follow-ups"]);
  });

  it("offers nothing when there is no follow-up session, or it cannot tell", async () => {
    asAdmin();
    server({ lookup: false });
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHAT, "Bring the flyer");
    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    expect(sheet().queryByRole("checkbox")).toBeNull();
  });

  describe("when the door is listed but not added to the session", () => {
    const ENDED =
      "This session has ended, so its households can no longer change. Reopen it first.";
    const failOnce = () => {
      asAdmin();
      let first = true;
      server({
        running: [SESSION],
        addToSession: () => {
          if (!first) return Promise.resolve({});
          first = false;
          return Promise.reject(new TypeError("Failed to fetch"));
        },
      });
    };
    const listOnce = async (onSaved = vi.fn(), onClose = vi.fn()) => {
      render(<FollowUpSheet mode={create} onClose={onClose} onSaved={onSaved} />);
      await sheet().findByRole("checkbox", { name: /Also add to/ });
      type(WHAT, "Bring the flyer");
      fireEvent.click(addButton());
      return sheet().findByRole("alert");
    };

    it("says so, and retries only the session step", async () => {
      failOnce();
      const onSaved = vi.fn();
      expect(await listOnce(onSaved)).toHaveTextContent(
        "Added to the follow-up list, but not to Saturday revisits. Try again, or add it from the session's page.",
      );
      expect(onSaved).not.toHaveBeenCalled();
      expect(sheet().queryByRole("checkbox")).toBeNull();

      fireEvent.click(sheet().getByRole("button", { name: "Add to Saturday revisits" }));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledWith(
          "Added to the follow-up list and to Saturday revisits.",
        );
      });
      expect(writes().map(([path]) => path)).toEqual([
        "/follow-ups",
        "/sessions/s1/households",
        "/sessions/s1/households",
      ]);
    });

    it("keeps saying so when the retry fails too", async () => {
      asAdmin();
      server({ running: [SESSION], addToSession: () => Promise.reject(new Error("down")) });
      const onSaved = vi.fn();
      await listOnce(onSaved);
      fireEvent.click(sheet().getByRole("button", { name: "Add to Saturday revisits" }));
      await waitFor(() => {
        expect(sheet().getByRole("button", { name: "Add to Saturday revisits" })).toBeEnabled();
      });
      expect(sheet().getByRole("alert")).toHaveTextContent("but not to Saturday revisits");
      expect(onSaved).not.toHaveBeenCalled();
    });

    it("says why the session turned the door away, and offers Done, not a retry", async () => {
      // The session ended between the sheet's lookup and the add.
      asAdmin();
      let refused = false;
      server({
        running: [SESSION],
        addToSession: () => {
          if (!refused) {
            refused = true;
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return Promise.reject(
            new ApiRequestError(409, { error: { code: "conflict", message: ENDED } }),
          );
        },
      });
      const onSaved = vi.fn();
      await listOnce(onSaved);
      fireEvent.click(sheet().getByRole("button", { name: "Add to Saturday revisits" }));
      await waitFor(() => {
        expect(sheet().getByRole("alert")).toHaveTextContent(
          `Added to the follow-up list, but not to Saturday revisits. ${ENDED}`,
        );
      });
      expect(sheet().queryByRole("button", { name: "Add to Saturday revisits" })).toBeNull();
      fireEvent.click(sheet().getByRole("button", { name: "Done" }));
      expect(onSaved).toHaveBeenCalledWith("Added to the follow-up list.");
    });

    it("closes without asking, since the note is saved", async () => {
      failOnce();
      const onSaved = vi.fn();
      const onClose = vi.fn();
      await listOnce(onSaved, onClose);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onSaved).toHaveBeenCalledWith("Added to the follow-up list.");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("is never offered to a member suggesting a door", async () => {
    const onSaved = vi.fn();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={onSaved} />);
    type(WHY, "Call back");
    fireEvent.click(sheet().getByRole("button", { name: "Send suggestion" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Suggestion sent. An admin will review it.");
    });
    expect(apiFetch.mock.calls.map(([path]) => String(path))).toEqual(["/follow-ups"]);
  });
});

describe("editing a note", () => {
  const edit = { kind: "edit", note: existing } as const;

  it("starts from what is there", () => {
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit follow-up, #05-123" })).toBeInTheDocument();
    // Its title keeps the word whole: "follow-" over "up" read as two (#196).
    expect(sheet().getByText("follow-up")).toHaveClass("whitespace-nowrap");
    expect(sheet().getByLabelText(WHAT)).toHaveValue("Bring the flyer.");
    expect(sheet().getByLabelText("Due (optional)")).toHaveValue("2026-11-01");
  });

  it("calls a suggestion a suggestion", () => {
    render(
      <FollowUpSheet
        mode={{ kind: "edit", note: { ...existing, status: "suggested" } }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Edit suggestion, #05-123" })).toBeInTheDocument();
    expect(sheet().getByLabelText(WHY)).toHaveValue("Bring the flyer.");
    expect(sheet().getByLabelText("Go back by (optional)")).toHaveValue("2026-11-01");
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
    type(WHAT, "Changed");
    fireEvent.click(sheet().getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the person who wrote this, or an admin, can change it.",
    );
    expect(sheet().getByLabelText(WHAT)).toHaveValue("Changed");
  });

  it("words a refusal outside the note's follow-up session", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "not_on_follow_up_list", message: "raw" } }),
    );
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHAT, "Changed");
    fireEvent.click(sheet().getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can mark this done during a follow-up session that includes this household.",
    );
  });

  it("offers no delete: removing a note is its own, explained, step", () => {
    render(<FollowUpSheet mode={edit} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Delete|Remove|Dismiss|Withdraw/ })).toBeNull();
  });
});

describe("a stray tap or flick", () => {
  const backdrop = () => screen.getByRole("button", { name: "Close" });
  const asking = (name: string) => within(screen.getByRole("alertdialog", { name }));

  it("closes an untouched sheet at once", () => {
    const onClose = vi.fn();
    render(<FollowUpSheet mode={create} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before losing a typed note, and keeps it to go on with", () => {
    const onClose = vi.fn();
    render(<FollowUpSheet mode={create} onClose={onClose} onSaved={vi.fn()} />);
    type(WHY, "Call back after six");
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      asking("Discard this note?").getByText("What you typed has not been saved."),
    ).toBeVisible();
    // Above the sheet it guards.
    expect(screen.getByRole("alertdialog").parentElement).toHaveClass("z-60");

    fireEvent.click(asking("Discard this note?").getByRole("button", { name: "Keep editing" }));
    expect(sheet().getByLabelText(WHY)).toHaveValue("Call back after six");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop());
    fireEvent.click(asking("Discard this note?").getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets Escape close only the question, then the sheet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FollowUpSheet mode={create} onClose={onClose} onSaved={vi.fn()} />);
    type(WHY, "Call back");
    fireEvent.click(backdrop());
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    expect(screen.getByRole("dialog").closest("[inert]")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("counts a due day on its own as something typed", () => {
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type("Go back by (optional)", "2026-12-24");
    fireEvent.click(backdrop());
    expect(screen.getByRole("alertdialog", { name: "Discard this note?" })).toBeInTheDocument();
  });

  it("asks about the changes to a note being edited, never as if deleting it", () => {
    const onClose = vi.fn();
    render(
      <FollowUpSheet mode={{ kind: "edit", note: existing }} onClose={onClose} onSaved={vi.fn()} />,
    );
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledOnce();

    type(WHAT, "Bring two flyers.");
    fireEvent.click(backdrop());
    expect(asking("Discard your changes?").getByText("The note stays as it was.")).toBeVisible();
    expect(screen.queryByRole("alertdialog", { name: "Discard this note?" })).toBeNull();
  });

  it("still closes at once from Cancel, with a note typed", () => {
    const onClose = vi.fn();
    render(<FollowUpSheet mode={create} onClose={onClose} onSaved={vi.fn()} />);
    type(WHY, "Call back");
    fireEvent.click(sheet().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the Not saved pop-up (#119)", () => {
  it("opens for a blank note, and OK puts focus back in it", async () => {
    const user = userEvent.setup();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, " \t ");
    await user.click(sheet().getByRole("button", { name: "Send suggestion" }));

    expect(notSaved().getByText("This note could not be saved because:")).toBeInTheDocument();
    expect(reasons()).toEqual(["The note is blank."]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    const note = sheet().getByLabelText(WHY);
    expect(note).toHaveFocus();
    expect(note).toHaveAccessibleDescription("Write the note first.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("opens for an edit that empties the note, and sends nothing", async () => {
    const user = userEvent.setup();
    asAdmin();
    render(
      <FollowUpSheet mode={{ kind: "edit", note: existing }} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    type(WHAT, "   ");
    await user.click(sheet().getByRole("button", { name: "Save changes" }));

    expect(reasons()).toEqual(["The note is blank."]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(sheet().getByLabelText(WHAT)).toHaveFocus();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("answers Escape and the backdrop itself, never the sheet's discard question", async () => {
    // A due day is typed work, so the sheet would ask before closing.
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FollowUpSheet mode={create} onClose={onClose} onSaved={vi.fn()} />);
    type("Go back by (optional)", "2026-12-24");
    await user.click(sheet().getByRole("button", { name: "Send suggestion" }));

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(sheet().getByLabelText(WHY)).toHaveFocus();

    await user.click(sheet().getByRole("button", { name: "Send suggestion" }));
    const [backdrop] = screen
      .getAllByRole("button", { name: "OK" })
      .filter((button) => !screen.getByRole("alertdialog").contains(button));
    if (backdrop === undefined) throw new Error("no backdrop");
    await user.click(backdrop);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
  });

  it("opens for the server's refusal of the note, under the note and not in the banner", async () => {
    apiFetch.mockRejectedValue(invalid("/note"));
    const user = userEvent.setup();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, "Call back");
    await user.click(sheet().getByRole("button", { name: "Send suggestion" }));

    expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
    expect(reasons()).toEqual(["The note is blank or too long."]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));

    const note = sheet().getByLabelText(WHY);
    expect(note).toHaveFocus();
    expect(note).toHaveValue("Call back");
    expect(note).toHaveAccessibleDescription("The note is blank or too long.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the server's words for another field, and leaves the note unmarked", async () => {
    apiFetch.mockRejectedValue(invalid("/dueDate", "Invalid ISO datetime"));
    const user = userEvent.setup();
    render(<FollowUpSheet mode={create} onClose={vi.fn()} onSaved={vi.fn()} />);
    type(WHY, "Call back");
    await user.click(sheet().getByRole("button", { name: "Send suggestion" }));

    expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
    expect(reasons()).toEqual(["Invalid ISO datetime"]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(sheet().getByLabelText(WHY)).toHaveAttribute("aria-invalid", "false");
    expect(sheet().getByRole("button", { name: "Send suggestion" })).toHaveFocus();
    // Nothing on the sheet marks the due date, so the banner still says why.
    expect(sheet().getByRole("alert")).toHaveTextContent("Not saved. Invalid ISO datetime");
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
