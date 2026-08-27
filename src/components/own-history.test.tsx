import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnHistoryScreen } from "@/components/own-history";
import type { SessionHistorySummary } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

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
