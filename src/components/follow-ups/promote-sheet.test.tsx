import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromoteButton } from "@/components/follow-ups/promote-button";
import { PromoteSheet } from "@/components/follow-ups/promote-sheet";
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

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const SUGGESTION: FollowUp = {
  id: "s1",
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "suggested",
  author: { id: "ann", name: "Ann Lee", image: null },
  note: "Asked us back after 7pm",
  dueDate: new Date(2026, 10, 1).toISOString(),
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  waitingSuggestionBy: null,
  createdAt: new Date(2026, 9, 20, 12).toISOString(),
};

const SESSION = {
  id: "fu1",
  title: "Saturday revisits",
  kind: "follow_up",
  status: "draft",
  startedAt: null,
  endedAt: null,
  createdBy: { id: "admin", name: "Admin", image: null },
  createdAt: "2026-10-20T08:00:00.000Z",
};

function server({
  drafts = [],
  promote = () => Promise.resolve({}),
  addToSession = () => Promise.resolve({}),
}: {
  drafts?: unknown[];
  promote?: () => Promise<unknown>;
  addToSession?: () => Promise<unknown>;
} = {}) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions?")) {
      return Promise.resolve({ data: path.includes("status=draft") ? drafts : [] });
    }
    if (path === "/sessions/fu1/households") return addToSession();
    return promote();
  });
}

const writes = () =>
  apiFetch.mock.calls
    .filter(([path]) => !String(path).startsWith("/sessions?"))
    .map(([path, init]): [string, unknown] => [
      String(path),
      JSON.parse((init as { body: string }).body) as unknown,
    ]);

const sheet = () => within(screen.getByRole("dialog"));
const addButton = () => sheet().getByRole("button", { name: "Add to list" });

beforeEach(() => {
  vi.clearAllMocks();
  useOnline.mockReturnValue(true);
  useRole.mockReturnValue({ userId: "admin", isAdmin: true });
  server();
});

describe("PromoteButton", () => {
  it("opens the suggestion in a sheet rather than listing it at once", async () => {
    const onPromoted = vi.fn();
    render(<PromoteButton suggestion={SUGGESTION} onPromoted={onPromoted} className="" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    expect(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    ).toBeVisible();
    expect(writes()).toEqual([]);

    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    fireEvent.click(addButton());
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledWith("Added to the follow-up list.");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes the sheet without listing anything", async () => {
    const onPromoted = vi.fn();
    render(<PromoteButton suggestion={SUGGESTION} onPromoted={onPromoted} className="" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    fireEvent.click(sheet().getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it("is not offered for a tap without signal, as no follow-up change is", () => {
    useOnline.mockReturnValue(false);
    render(<PromoteButton suggestion={SUGGESTION} onPromoted={vi.fn()} className="" />);
    const add = screen.getByRole("button", { name: "Add to follow-up list" });
    expect(add).toBeDisabled();
    expect(within(add).getByText("follow-up")).toHaveClass("whole-word");
  });
});

describe("PromoteSheet", () => {
  it("shows the door, the suggestion and who made it before it is listed", () => {
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // The title keeps the word whole: "follow-" over "up" read as two (#196).
    expect(within(dialog).getByText("follow-up")).toHaveClass("whole-word");
    expect(dialog).toHaveTextContent("Blk 123 · #05-123");
    expect(dialog).toHaveTextContent("Asked us back after 7pm");
    expect(dialog).toHaveTextContent("Go back by 1 Nov 2026");
    expect(dialog).toHaveTextContent("Suggested by Ann Lee · 20 Oct 2026 · Waiting for review");
  });

  it("leaves out a date the member did not give", () => {
    render(
      <PromoteSheet
        suggestion={{ ...SUGGESTION, dueDate: null }}
        onClose={vi.fn()}
        onPromoted={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Go back by");
  });

  it("lists the suggestion itself, and adds it to the follow-up session too", async () => {
    server({ drafts: [SESSION] });
    const onPromoted = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={onPromoted} />);
    expect(
      await sheet().findByRole("checkbox", { name: "Also add to Saturday revisits" }),
    ).toBeChecked();
    fireEvent.click(addButton());
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledWith(
        "Added to the follow-up list and to Saturday revisits.",
      );
    });
    expect(writes()).toEqual([
      ["/follow-ups/s1", { status: "listed" }],
      ["/sessions/fu1/households", { householdIds: ["h1"] }],
    ]);
  });

  it("sends one request however often it is tapped while working", async () => {
    let finish: (value: unknown) => void = () => undefined;
    server({
      promote: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const onPromoted = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={onPromoted} />);
    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    act(() => {
      fireEvent.click(addButton());
      fireEvent.click(addButton());
    });
    expect(writes()).toHaveLength(1);
    expect(sheet().getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish({});
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledTimes(1);
    });
  });

  it("says why listing failed, and stays open for another go", async () => {
    server({
      promote: () =>
        Promise.reject(new ApiRequestError(404, { error: { code: "not_found", message: "x" } })),
    });
    const onPromoted = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={onPromoted} />);
    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    fireEvent.click(addButton());
    expect(await sheet().findByRole("alert")).toHaveTextContent(
      "That note or unit is no longer there. Refresh to see the latest.",
    );
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it("says when it is listed but not in the session, and retries only that", async () => {
    let first = true;
    server({
      drafts: [SESSION],
      addToSession: () => {
        if (!first) return Promise.resolve({});
        first = false;
        return Promise.reject(new TypeError("Failed to fetch"));
      },
    });
    const onPromoted = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={onPromoted} />);
    await sheet().findByRole("checkbox", { name: /Also add to/ });
    fireEvent.click(addButton());
    expect(await sheet().findByRole("alert")).toHaveTextContent(
      "Added to the follow-up list, but not to Saturday revisits. Try again, or add it from the session's page.",
    );

    fireEvent.click(sheet().getByRole("button", { name: "Add to Saturday revisits" }));
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledWith(
        "Added to the follow-up list and to Saturday revisits.",
      );
    });
    expect(writes().map(([path]) => path)).toEqual([
      "/follow-ups/s1",
      "/sessions/fu1/households",
      "/sessions/fu1/households",
    ]);
  });

  it("keeps the partial alert when the retry fails, and closes without asking", async () => {
    server({ drafts: [SESSION], addToSession: () => Promise.reject(new Error("down")) });
    const onPromoted = vi.fn();
    const onClose = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={onClose} onPromoted={onPromoted} />);
    await sheet().findByRole("checkbox", { name: /Also add to/ });
    fireEvent.click(addButton());
    const retry = await sheet().findByRole("button", { name: "Add to Saturday revisits" });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(retry).toBeEnabled();
    });
    expect(sheet().getByRole("alert")).toHaveTextContent("but not to Saturday revisits");
    expect(onPromoted).not.toHaveBeenCalled();

    fireEvent.click(sheet().getByRole("button", { name: "Cancel" }));
    expect(onPromoted).toHaveBeenCalledWith("Added to the follow-up list.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says why the session turned the door away, and offers Done, not a retry", async () => {
    const ENDED =
      "This session has ended, so its households can no longer change. Reopen it first.";
    server({
      drafts: [SESSION],
      addToSession: () =>
        Promise.reject(new ApiRequestError(409, { error: { code: "conflict", message: ENDED } })),
    });
    const onPromoted = vi.fn();
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={onPromoted} />);
    await sheet().findByRole("checkbox", { name: /Also add to/ });
    fireEvent.click(addButton());
    expect(await sheet().findByRole("alert")).toHaveTextContent(
      `Added to the follow-up list, but not to Saturday revisits. ${ENDED}`,
    );
    expect(sheet().queryByRole("button", { name: "Add to Saturday revisits" })).toBeNull();
    fireEvent.click(sheet().getByRole("button", { name: "Done" }));
    expect(onPromoted).toHaveBeenCalledWith("Added to the follow-up list.");
    expect(writes().map(([path]) => path)).toEqual(["/follow-ups/s1", "/sessions/fu1/households"]);
  });

  it("is disabled offline and says why", async () => {
    useOnline.mockReturnValue(false);
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Connect to change follow-ups")).toBeInTheDocument();
    });
    expect(addButton()).toBeDisabled();
  });

  it("sits above the bottom nav", () => {
    render(<PromoteSheet suggestion={SUGGESTION} onClose={vi.fn()} onPromoted={vi.fn()} />);
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
  });
});
