import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowUpsScreen, parseFollowUpView } from "@/components/follow-ups/follow-ups-screen";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

/* A follow-up session that picked the notes' households, so a member may resolve. */
const { useActiveSession } = vi.hoisted(() => ({ useActiveSession: vi.fn() }));
vi.mock("@/lib/hooks/use-active-session", () => ({ useActiveSession }));
const FOLLOW_UP = {
  session: { kind: "follow_up", startedAt: "2026-01-01T00:00:00.000Z" },
  blocks: [{ block: { id: "b1" } }],
  householdIds: ["h-1", "h-2"],
};

/* Tested on its own; here it would only add a request to every count. */
vi.mock("@/components/follow-ups/declined-notice", () => ({
  DeclinedNotice: ({ userId }: { userId: string }) => <p>{`declined notice for ${userId}`}</p>,
}));

const { replace, search } = vi.hoisted(() => ({ replace: vi.fn(), search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

function note(id: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: `h-${id}`,
    blockId: "b1",
    blockName: "123",
    unitNumber: `#05-${id}`,
    visitId: null,
    status: "listed",
    author: { id: "u1", name: "Alice", image: null },
    note: `Note ${id}`,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-03-14T10:00:00.000Z",
    ...overrides,
  };
}

type Settle = {
  resolve: (value: FollowUpList) => void;
  reject: (reason: unknown) => void;
};

const page = (data: FollowUp[], total = data.length, offset = 0): FollowUpList => ({
  data,
  pagination: { limit: 20, offset, total, hasMore: offset + data.length < total },
});

beforeEach(() => {
  vi.clearAllMocks();
  search.value = "";
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
  useActiveSession.mockReturnValue(FOLLOW_UP);
  localStorage.clear();
});

const LIST = "/follow-ups?status=listed&outstanding=true&limit=20&offset=0";

describe("parseFollowUpView", () => {
  it("reads only the known views, and the list otherwise", () => {
    expect(parseFollowUpView(new URLSearchParams("view=mine"))).toBe("mine");
    expect(parseFollowUpView(new URLSearchParams("view=review"))).toBe("review");
    expect(parseFollowUpView(new URLSearchParams("view=team"))).toBe("list");
    expect(parseFollowUpView(new URLSearchParams())).toBe("list");
  });
});

describe("FollowUpsScreen", () => {
  it("lists what is owed on the follow-up list by default, naming and linking each door", async () => {
    apiFetch.mockResolvedValue(page([note("1"), note("2")]));
    render(<FollowUpsScreen />);

    expect(await screen.findByRole("link", { name: "Blk 123 · #05-1" })).toHaveAttribute(
      "href",
      "/households/h-1",
    );
    expect(apiFetch).toHaveBeenCalledWith(LIST);
    expect(screen.getByRole("button", { name: "On the list" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows every suggestion waiting for review", async () => {
    search.value = "view=review";
    apiFetch.mockResolvedValue(
      page([note("1", { status: "suggested", author: { id: "u2", name: "Ben", image: null } })]),
    );
    render(<FollowUpsScreen />);
    expect(await screen.findByText(/^Suggested by Ben · .* · Waiting for review$/)).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups?status=suggested&limit=20&offset=0");
  });

  it("says so when no suggestion waits", async () => {
    search.value = "view=review";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("No suggestions waiting.")).toBeInTheDocument();
  });

  it("asks for the viewer's own notes under Mine, and says how to start one", async () => {
    search.value = "view=mine";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);

    expect(await screen.findByText("You have no follow-ups or suggestions.")).toBeInTheDocument();
    expect(
      screen.getByText("Open a household and tap Suggest a return visit."),
    ).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      "/follow-ups?authorId=u1&outstanding=true&limit=20&offset=0",
    );
  });

  it("tells the member about suggestions that were not added", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("declined notice for u1")).toBeInTheDocument();
  });

  it("explains follow-ups once, until dismissed on this phone", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    const hint = await screen.findByRole("region", { name: "What are follow-ups?" });
    expect(hint).toHaveTextContent("Admins choose which households go on the follow-up list.");
    // The one way to ask for a household, the same on every screen.
    expect(hint).toHaveTextContent("Tap Suggest a return visit on its page");
    expect(hint).not.toHaveTextContent(/ask an admin/i);
    fireEvent.click(within(hint).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "What are follow-ups?" })).toBeNull();
  });

  it("puts the views first and the explanation last, so a first visit still shows the list", async () => {
    apiFetch.mockResolvedValue(page([note("1")]));
    render(<FollowUpsScreen />);
    const views = screen.getByRole("group", { name: "Which follow-ups" });
    const declined = screen.getByText("declined notice for u1");
    const first = await screen.findByText("Note 1");
    const hint = screen.getByRole("region", { name: "What are follow-ups?" });
    const before = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(views, declined)).toBe(true);
    expect(before(declined, first)).toBe(true);
    expect(before(first, hint)).toBe(true);
  });

  it.each([
    ["their own", { id: "u1", name: "Alice", image: null }],
    ["another member's", { id: "u2", name: "Ben", image: null }],
  ])("never offers a member a way to take %s listed note off the list", async (_, author) => {
    apiFetch.mockResolvedValue(page([note("1", { author })]));
    render(<FollowUpsScreen />);
    // Mark done is there, so the session lets the member act on the note.
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeInTheDocument();
    for (const name of ["Withdraw", "Remove from list", "Dismiss"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("waits for the viewer before asking for Mine", async () => {
    search.value = "view=mine";
    useRole.mockReturnValue({ userId: undefined, isAdmin: false });
    render(<FollowUpsScreen />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says so when nothing is on the list, and who adds to it", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("Nothing is on the follow-up list.")).toBeInTheDocument();
    expect(
      screen.getByText("Admins add households here for follow-up sessions."),
    ).toBeInTheDocument();
  });

  it("switches views through the URL", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("Nothing is on the follow-up list.");

    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(replace).toHaveBeenCalledWith("/follow-ups?view=mine");
    fireEvent.click(screen.getByRole("button", { name: "Waiting for review" }));
    expect(replace).toHaveBeenCalledWith("/follow-ups?view=review");

    fireEvent.click(screen.getByRole("button", { name: "On the list" }));
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("goes back to the list without a query", async () => {
    search.value = "view=mine";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("You have no follow-ups or suggestions.");
    fireEvent.click(screen.getByRole("button", { name: "On the list" }));
    expect(replace).toHaveBeenCalledWith("/follow-ups");
  });

  it("pages with Show more", async () => {
    apiFetch
      .mockResolvedValueOnce(page([note("1")], 2))
      .mockResolvedValueOnce(page([note("2")], 2, 1));
    render(<FollowUpsScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Note 2")).toBeInTheDocument();
    expect(screen.getByText("Note 1")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/follow-ups?status=listed&outstanding=true&limit=20&offset=1",
    );
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("marks an overdue note", async () => {
    apiFetch.mockResolvedValue(page([note("1", { dueDate: "2020-01-01T00:00:00.000Z" })]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
  });

  it("re-reads from the top after a note is marked done", async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === "PATCH" ? {} : page(apiFetch.mock.calls.length > 1 ? [] : [note("1")]),
      ),
    );
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("Nothing is on the follow-up list.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/1", {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
  });

  it("edits a note in the sheet and re-reads", async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === "PATCH" ? {} : page([note("1")])),
    );
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = within(screen.getByRole("dialog", { name: "Edit follow-up, #05-1" }));
    fireEvent.change(sheet.getByLabelText("What should the next visit do?"), {
      target: { value: "Changed" },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetch).toHaveBeenLastCalledWith(LIST);
  });

  it("closes the sheet on Cancel", async () => {
    apiFetch.mockResolvedValue(page([note("1")]));
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("reports a failed read and retries", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing is on the follow-up list.")).toBeInTheDocument();
  });

  /* A promise settles once, so the late answer and the late failure each
     need their own first request. */
  it.each([
    [
      "answer",
      (first: Settle) => {
        first.resolve(page([note("1")]));
      },
    ],
    [
      "failure",
      (first: Settle) => {
        first.reject(new Error("late"));
      },
    ],
  ])("lets only the newest answer land, not a late %s", async (_, settle) => {
    const first: Settle = { resolve: () => undefined, reject: () => undefined };
    apiFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            first.resolve = resolve;
            first.reject = reject;
          }),
      )
      .mockResolvedValue(page([]));
    const { rerender } = render(<FollowUpsScreen />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    search.value = "view=mine";
    rerender(<FollowUpsScreen />);
    expect(await screen.findByText("You have no follow-ups or suggestions.")).toBeInTheDocument();

    settle(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("You have no follow-ups or suggestions.")).toBeInTheDocument();
    expect(screen.queryByText("Note 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
