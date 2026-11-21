import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
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
  picks: [
    { householdId: "h-1", addedAt: "2025-12-31T00:00:00.000Z" },
    { householdId: "h-2", addedAt: "2025-12-31T00:00:00.000Z" },
  ],
};

/* Tested on its own; here it would only add a request to every count. */
vi.mock("@/components/follow-ups/declined-notice", () => ({
  DeclinedNotice: ({ userId }: { userId: string }) => <p>{`declined notice for ${userId}`}</p>,
}));

/* The router's copy of the address, which a test moves only as Back or
   Forward would. No useRouter: a tab that went through it would throw here. */
const { search } = vi.hoisted(() => ({ search: { value: "" } }));
vi.mock("next/navigation", () => ({
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

let replaceState: MockInstance<History["replaceState"]>;

beforeEach(() => {
  vi.clearAllMocks();
  search.value = "";
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
  useActiveSession.mockReturnValue(FOLLOW_UP);
  localStorage.clear();
  window.history.replaceState(null, "", "/follow-ups");
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  replaceState.mockRestore();
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

  /* The list names nobody, so it need not wait for the session to ask (#252);
     its notes carry the viewer's controls, so they wait to be drawn. */
  it.each([
    ["the list", "", "listed", LIST, "Remove from list"],
    [
      "review",
      "view=review",
      "suggested",
      "/follow-ups?status=suggested&limit=20&offset=0",
      "Add to list",
    ],
  ] as const)(
    "asks for %s before the session names the viewer, once, and draws it only for a viewer",
    async (_, view, status, path, adminAction) => {
      search.value = view;
      useRole.mockReturnValue({ userId: undefined, isAdmin: false });
      apiFetch.mockResolvedValue(page([note("1", { status })]));
      const { rerender } = render(<FollowUpsScreen />);
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledExactlyOnceWith(path);
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      expect(screen.queryByText("Note 1")).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();

      useRole.mockReturnValue({ userId: "u1", isAdmin: true });
      rerender(<FollowUpsScreen />);
      expect(await screen.findByRole("button", { name: adminAction })).toBeInTheDocument();
      expect(screen.getByText("Note 1")).toBeInTheDocument();
      expect(screen.queryByText("Loading…")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(apiFetch).toHaveBeenCalledOnce();
    },
  );

  /* The list is asked for while Mine still waits for the viewer, so its answer
     can land after Mine is chosen. The tap and the address are guarded apart:
     the address follows a tap a moment later, and a link changes it alone. */
  it.each([
    ["tapped, and the list answers before the address follows", true],
    ["reached by the address, and the list answers after", false],
  ])(
    "never draws the list under Mine when Mine is %s and the session names the viewer late",
    async (_, tapped) => {
      useRole.mockReturnValue({ userId: undefined, isAdmin: false });
      const answers = new Map<string, (value: FollowUpList) => void>();
      apiFetch.mockImplementation(
        (path: string) =>
          new Promise<FollowUpList>((resolve) => {
            answers.set(path, resolve);
          }),
      );
      const MINE = "/follow-ups?authorId=u1&outstanding=true&limit=20&offset=0";
      const answer = (path: string, value: FollowUpList) => {
        const resolve = answers.get(path);
        expect(resolve).toBeDefined();
        resolve?.(value);
      };
      const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

      const { rerender } = render(<FollowUpsScreen />);
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledExactlyOnceWith(LIST);
      });
      const toMine = () => {
        search.value = "view=mine";
        rerender(<FollowUpsScreen />);
      };
      if (tapped) {
        fireEvent.click(screen.getByRole("button", { name: "Mine" }));
        answer(LIST, page([note("1")], 2));
        await settle();
        toMine();
      } else {
        toMine();
        await settle();
        answer(LIST, page([note("1")], 2));
      }
      await settle();

      useRole.mockReturnValue({ userId: "u1", isAdmin: false });
      rerender(<FollowUpsScreen />);
      await waitFor(() => {
        expect(apiFetch).toHaveBeenLastCalledWith(MINE);
      });
      expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      expect(screen.queryByText("Note 1")).toBeNull();
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

      answer(MINE, page([note("2", { status: "suggested" })]));
      expect(await screen.findByText("Note 2")).toBeInTheDocument();
      expect(screen.queryByText("Note 1")).toBeNull();
    },
  );

  it("says so when nothing is on the list, and who adds to it", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("Nothing is on the follow-up list.")).toBeInTheDocument();
    expect(
      screen.getByText("Admins add households here for follow-up sessions."),
    ).toBeInTheDocument();
  });

  /* Not router.replace: once Next's copy of the route is five minutes old,
     that asks the server again, and with no signal the screen became Offline. */
  it("switches views at once through the address, before the router reports it", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("Nothing is on the follow-up list.");

    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/follow-ups?view=mine");
    expect(await screen.findByText("You have no follow-ups or suggestions.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      "/follow-ups?authorId=u1&outstanding=true&limit=20&offset=0",
    );

    fireEvent.click(screen.getByRole("button", { name: "Waiting for review" }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/follow-ups?view=review");
    expect(window.location.search).toBe("?view=review");
    expect(await screen.findByText("No suggestions waiting.")).toBeInTheDocument();

    // The view already shown writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "Waiting for review" }));
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it("goes back to the list without a query", async () => {
    window.history.replaceState(null, "", "/follow-ups?view=mine");
    replaceState.mockClear();
    search.value = "view=mine";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("You have no follow-ups or suggestions.");
    fireEvent.click(screen.getByRole("button", { name: "On the list" }));
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/follow-ups");
    expect(window.location.search).toBe("");
    expect(await screen.findByText("Nothing is on the follow-up list.")).toBeInTheDocument();
  });

  it("takes the view from an address that changes under it, as Back or Forward does", async () => {
    apiFetch.mockResolvedValue(page([]));
    const { rerender } = render(<FollowUpsScreen />);
    await screen.findByText("Nothing is on the follow-up list.");

    search.value = "view=review";
    rerender(<FollowUpsScreen />);

    expect(screen.getByRole("button", { name: "Waiting for review" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups?status=suggested&limit=20&offset=0");
    });
    expect(replaceState).not.toHaveBeenCalled();
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
