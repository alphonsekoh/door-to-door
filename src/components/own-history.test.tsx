import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnHistoryScreen } from "@/components/own-history";
import type { HistoryEntry, SessionHistorySummary } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const { replace, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: { value: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams.value,
}));

function summary(id: string, title: string): SessionHistorySummary {
  const at = "2026-03-14T11:00:00.000Z";
  return {
    session: {
      id,
      title,
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: at,
    },
    blocks: [{ id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: at }],
    visitCount: 2,
    householdCount: 2,
    interest: { low: 1, medium: 0, high: 1, noResponse: 0 },
    firstRecordedAt: at,
    lastRecordedAt: at,
  };
}

const sessionPage = (rows: SessionHistorySummary[], total = rows.length) => ({
  data: rows,
  pagination: { limit: 20, offset: 0, total, hasMore: rows.length < total },
});

const notePage = (notes: unknown[]) => ({
  data: notes,
  pagination: { limit: 10, offset: 0, total: notes.length, hasMore: false },
});

/* Routed by path so a test that breaks one call cannot be satisfied by the
   other, and so the follow-up fetch can fail on its own. */
function serve(sessions: unknown, notes: unknown = notePage([])) {
  apiFetch.mockImplementation((path: string) =>
    path.startsWith("/follow-ups") ? Promise.resolve(notes) : Promise.resolve(sessions),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
  useRole.mockReturnValue({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("OwnHistoryScreen", () => {
  it("lists the outings the member worked", async () => {
    serve(sessionPage([summary("s1", "June outing"), summary("s2", "March outing")]));
    render(<OwnHistoryScreen />);

    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(screen.getByText("March outing")).toBeInTheDocument();
  });

  it("asks only for the caller's own outings", async () => {
    serve(sessionPage([]));
    render(<OwnHistoryScreen />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/history/mine/sessions?limit=20&offset=0");
    });
  });

  it("scopes the follow-up notes to the signed-in member", async () => {
    serve(sessionPage([]));
    render(<OwnHistoryScreen />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups?authorId=u1&outstanding=true&limit=10");
    });
  });

  it("surfaces the notes the member still owes", async () => {
    serve(
      sessionPage([summary("s1", "June outing")]),
      notePage([
        {
          id: "f1",
          householdId: "h1",
          visitId: null,
          author: { id: "u1", name: "Alice", image: null },
          note: "Bring the book back",
          dueDate: null,
          doneAt: null,
          doneBy: null,
          createdAt: "2026-03-14T10:00:00.000Z",
        },
      ]),
    );
    render(<OwnHistoryScreen />);

    expect(await screen.findByText("Bring the book back")).toBeInTheDocument();
  });

  it("still shows the history when the notes cannot be fetched", async () => {
    // The notes are a bonus here; losing them must not lose the screen.
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/follow-ups")
        ? Promise.reject(new Error("nope"))
        : Promise.resolve(sessionPage([summary("s1", "June outing")])),
    );
    render(<OwnHistoryScreen />);

    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("offers a member with no history something to do", async () => {
    serve(sessionPage([]));
    render(<OwnHistoryScreen />);

    expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier outings/ })).not.toBeInTheDocument();
  });

  it("appends the next page rather than replacing what is shown", async () => {
    const user = userEvent.setup();
    serve(sessionPage([summary("s1", "June outing")], 2));
    render(<OwnHistoryScreen />);
    await screen.findByText("June outing");

    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/follow-ups")
        ? Promise.resolve(notePage([]))
        : Promise.resolve(sessionPage([summary("s2", "March outing")], 2)),
    );
    await user.click(screen.getByRole("button", { name: "Show earlier outings" }));

    expect(await screen.findByText("March outing")).toBeInTheDocument();
    expect(screen.getByText("June outing")).toBeInTheDocument();
  });

  it("asks for the next page by how much is already shown", async () => {
    const user = userEvent.setup();
    serve(sessionPage([summary("s1", "June outing")], 2));
    render(<OwnHistoryScreen />);
    await screen.findByText("June outing");

    await user.click(screen.getByRole("button", { name: "Show earlier outings" }));
    expect(apiFetch).toHaveBeenCalledWith("/history/mine/sessions?limit=20&offset=1");
  });

  it("hides the button once everything is shown", async () => {
    serve(sessionPage([summary("s1", "June outing")], 1));
    render(<OwnHistoryScreen />);
    await screen.findByText("June outing");

    expect(screen.queryByRole("button", { name: /earlier outings/ })).not.toBeInTheDocument();
  });

  it("offers a retry when the history fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<OwnHistoryScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    serve(sessionPage([summary("s1", "June outing")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<OwnHistoryScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your history.");
  });

  it("does not ask for notes before the session resolves", async () => {
    useRole.mockReturnValue({
      userId: undefined,
      role: undefined,
      isAdmin: false,
      isMember: false,
      isLoading: true,
      isSignedIn: false,
    });
    serve(sessionPage([]));
    render(<OwnHistoryScreen />);

    await screen.findByText("Nothing recorded yet.");
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/follow-ups"));
  });
});

const AT = "2026-03-14T11:00:00.000Z";

function record(unitNumber: string, author = { id: "u2", name: "Ben Lim" }): HistoryEntry {
  return {
    visit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { ...author, image: null },
      team: { id: "t1", name: "Ann & Ben", members: [{ id: "u1", name: "Ann Tan", image: null }] },
      interestLevel: "high",
      description: "",
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
    household: {
      id: `h-${unitNumber}`,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    session: {
      id: "s1",
      title: "June outing",
      status: "active",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  };
}

const recordPage = (rows: HistoryEntry[], total = rows.length) => ({
  data: rows,
  pagination: { limit: 20, offset: 0, total, hasMore: rows.length < total },
});

describe("Me or My team", () => {
  /* Follow-ups are read alongside the list, so reads are routed by path and
     the list's answers queued in order. */
  let queue: (() => unknown)[] = [];
  let fallback: unknown = recordPage([]);
  const once = (value: unknown) => queue.push(() => Promise.resolve(value));
  /* Via a mock, so a non-Error reason can be rejected as a real fetch might. */
  const onceReject = (error: unknown) =>
    queue.push(() => vi.fn().mockRejectedValue(error)() as Promise<never>);
  const setFallback = (value: unknown) => {
    fallback = value;
  };

  beforeEach(() => {
    queue = [];
    fallback = recordPage([]);
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/follow-ups")) return Promise.resolve(notePage([]));
      if (path.startsWith("/history/mine/sessions")) return Promise.resolve(sessionPage([]));
      const next = queue.shift();
      return next === undefined ? Promise.resolve(fallback) : next();
    });
  });

  it("writes the team view to the URL", async () => {
    const user = userEvent.setup();
    serve(sessionPage([]));
    render(<OwnHistoryScreen />);

    await user.click(await screen.findByRole("button", { name: "My team" }));
    expect(replace).toHaveBeenCalledWith("/history?view=team");
  });

  it("goes back to Me", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    setFallback(recordPage([]));
    render(<OwnHistoryScreen />);

    await user.click(await screen.findByRole("button", { name: "Me" }));
    expect(replace).toHaveBeenCalledWith("/history");
  });

  it("lists records including the team's, and never touches the outing counts", async () => {
    searchParams.value = new URLSearchParams("view=team");
    setFallback(recordPage([record("#05-123")]));
    render(<OwnHistoryScreen />);

    expect(await screen.findByText("By Ben Lim with Ann Tan")).toBeInTheDocument();
    expect(screen.getByText(/June outing ·/)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/history/mine?limit=20&offset=0&includeTeam=true");
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/history/mine/sessions"));
    expect(screen.getByText(/Your outing list counts only your own records/)).toBeInTheDocument();
  });

  it("lets a teammate's record be amended from the list", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    setFallback(recordPage([record("#05-123")]));
    render(<OwnHistoryScreen />);

    await user.click(await screen.findByRole("button", { name: "Amend #05-123" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("says so when neither the member nor their team has recorded anything", async () => {
    searchParams.value = new URLSearchParams("view=team");
    setFallback(recordPage([]));
    render(<OwnHistoryScreen />);
    expect(
      await screen.findByText("Nothing recorded by you or your team yet."),
    ).toBeInTheDocument();
  });

  it("appends earlier records", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    once(recordPage([record("#05-123")], 2));
    render(<OwnHistoryScreen />);

    once(recordPage([record("#05-124")], 2));
    await user.click(await screen.findByRole("button", { name: "Show earlier records" }));

    expect(await screen.findByText("#05-124")).toBeInTheDocument();
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/history/mine?limit=20&offset=1&includeTeam=true");
    expect(screen.queryByRole("button", { name: "Show earlier records" })).not.toBeInTheDocument();
  });

  it("offers a retry when the team records fail to load", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    onceReject("boom");
    render(<OwnHistoryScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your team's records.",
    );
    once(recordPage([record("#05-123")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("#05-123")).toBeInTheDocument();
  });

  it("shows the server's reason for a failure", async () => {
    searchParams.value = new URLSearchParams("view=team");
    onceReject(new Error("Your sign-in has ended."));
    render(<OwnHistoryScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your sign-in has ended.");
  });

  it("drops a late page that a reload after an amend has overtaken", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    once(recordPage([record("#05-123")], 2));
    render(<OwnHistoryScreen />);

    const slow: { resolve: (value: unknown) => void } = { resolve: () => undefined };
    queue.push(
      () =>
        new Promise((resolve) => {
          slow.resolve = resolve;
        }),
    );
    await user.click(await screen.findByRole("button", { name: "Show earlier records" }));

    once({}); // the PATCH
    once(recordPage([record("#05-123")], 1)); // the reload
    await user.click(screen.getByRole("button", { name: "Amend #05-123" }));
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await act(async () => {
      slow.resolve(recordPage([record("#07-777")], 2));
      await Promise.resolve();
    });
    expect(screen.queryByText("#07-777")).not.toBeInTheDocument();
  });

  it("drops a late failure that a newer load has overtaken", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("view=team");
    once(recordPage([record("#05-123")], 2));
    render(<OwnHistoryScreen />);

    const slow: { reject: (error: unknown) => void } = { reject: () => undefined };
    queue.push(
      () =>
        new Promise((_resolve, reject) => {
          slow.reject = reject;
        }),
    );
    await user.click(await screen.findByRole("button", { name: "Show earlier records" }));

    once({});
    once(recordPage([record("#05-123")], 1));
    await user.click(screen.getByRole("button", { name: "Amend #05-123" }));
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await act(async () => {
      slow.reject(new Error("late"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("#05-123")).toBeInTheDocument();
  });

  it("gives the team view its own subtitle, and Me its own", async () => {
    searchParams.value = new URLSearchParams("view=team");
    const { unmount } = render(<OwnHistoryScreen />);
    expect(
      await screen.findByText("Records by you and the teams you are on now, newest first."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    unmount();

    searchParams.value = new URLSearchParams();
    render(<OwnHistoryScreen />);
    expect(await screen.findByText("Outings you have worked, newest first.")).toBeInTheDocument();
  });

  it("keeps the member's outstanding follow-ups in the team view", async () => {
    searchParams.value = new URLSearchParams("view=team");
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/follow-ups")
          ? notePage([
              {
                id: "f1",
                householdId: "h1",
                visitId: null,
                author: { id: "u1", name: "Alice", image: null },
                note: "Bring the book back",
                dueDate: null,
                doneAt: null,
                doneBy: null,
                createdAt: AT,
              },
            ])
          : recordPage([record("#05-123")]),
      ),
    );
    render(<OwnHistoryScreen />);
    expect(await screen.findByText("Bring the book back")).toBeInTheDocument();
    expect(await screen.findByText("#05-123")).toBeInTheDocument();
  });
});
