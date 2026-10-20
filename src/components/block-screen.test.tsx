import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { BlockScreen } from "@/components/block-screen";
import { ApiRequestError } from "@/lib/api-client";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { noteOuting, noteBlock } = vi.hoisted(() => ({ noteOuting: vi.fn(), noteBlock: vi.fn() }));
vi.mock("@/components/local-copy-writer", () => ({
  useLocalCopyWriter: () => ({ noteOuting, noteBlock }),
}));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

/* Unavailable unless a test says otherwise, so a save goes straight to the
   server as it does where IndexedDB cannot be opened. */
const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync-provider", () => ({ useSyncQueue }));
const NO_QUEUE = {
  records: [] as QueuedVisit[],
  inFlight: new Set<string>(),
  justSaved: new Set<string>(),
  block: null,
  syncedVersion: 0,
  ownerId: undefined,
  enqueue: null,
  retry: vi.fn(),
  retryAll: vi.fn(),
};

type Author = { id: string; name: string };
const BEN: Author = { id: "u1", name: "Ben Lim" };

const list = (units: string[], author: Author = BEN, teamId: string | null = null) => ({
  data: units.map((unitNumber, i) => ({
    household: {
      id: `h${String(i)}`,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: "",
      updatedAt: "",
    },
    visitCount: 1,
    latestVisit: {
      id: `v${String(i)}`,
      householdId: `h${String(i)}`,
      sessionId: "s1",
      member: { ...author, image: null },
      team: teamId === null ? null : { id: teamId, name: "Ann & Ben", members: [] },
      interestLevel: "low" as const,
      description: "",
      clientCreatedAt: "",
      createdAt: "",
      updatedAt: "",
    },
    outstandingFollowUps: 0,
  })),
  pagination: { limit: 100, offset: 0, total: units.length, hasMore: false },
});

const active = { session: { id: "s1", title: "Tonight" }, blocks: [] };

/* Routes by path so the two loads can differ, and so a test that breaks one
   does not silently satisfy the other. */
function serve(households: unknown, session: unknown = active, teams: unknown = { data: [] }) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions/active")) return Promise.resolve(session);
    if (path === "/sessions/s1/teams") return Promise.resolve(teams);
    return Promise.resolve(households);
  });
}

const teamOf = (id: string, memberIds: string[]) => ({
  data: [
    {
      id,
      sessionId: "s1",
      name: "Ann & Ben",
      members: memberIds.map((member) => ({ id: member, name: member, image: null })),
      createdAt: "",
    },
  ],
});

type Late = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

async function openUnit(unitNumber: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "All units (1)" }));
  await user.click(screen.getByRole("button", { name: new RegExp(unitNumber) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useSyncQueue.mockReturnValue(NO_QUEUE);
  useRole.mockReturnValue({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("BlockScreen", () => {
  it("is named for its block once the outing says which one it is, with a way back", async () => {
    serve(list([]), {
      ...active,
      blocks: [
        {
          block: {
            id: "b1",
            name: "123",
            street: "Ang Mo Kio Ave 3",
            postalCode: null,
            createdAt: "",
          },
          visitCount: 0,
          householdCount: 0,
          activeMembers: [],
        },
      ],
    });
    render(<BlockScreen blockId="b1" />);
    // Generic only until the outing answers.
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Blk 123" })).toBeInTheDocument();
    expect(screen.getByText("Ang Mo Kio Ave 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Session" })).toHaveAttribute("href", "/");
  });

  it("stays generic for a block the outing does not have", async () => {
    serve(list([]));
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/active");
    });
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toBeInTheDocument();
  });

  it("loads the units already recorded on this block", async () => {
    serve(list(["#05-123", "#05-124"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/households?blockId=b1&limit=100");
  });

  it("opens on the recording form, not the list", async () => {
    // At a door the form is the whole job; the list is for between floors.
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the unit list and back", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    expect(screen.getByLabelText("Search this block")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and next" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Record" }));
    expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });

  it("still shows the form when the unit list fails to load", async () => {
    // Recording must not depend on the history lookup succeeding.
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this block.");
  });

  it("still lists units when the running session cannot be identified", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new Error("No session is active."))
        : Promise.resolve(list(["#05-123"])),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByText("tonight")).not.toBeInTheDocument();
  });

  it("reloads the unit list after a visit is recorded", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });

    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });

  it("reloads the unit list after an amendment", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    await user.click(screen.getByRole("button", { name: /#05-123/ }));
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits/v0") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });

  it("shows who recorded each unit, in words", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await user.click(await screen.findByRole("tab", { name: "All units (1)" }));
    expect(screen.getByText("By Ben Lim")).toBeInTheDocument();
  });

  it("opens a current teammate's unit for amending", async () => {
    serve(
      list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"),
      active,
      teamOf("t1", ["ann", "u1"]),
    );
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("keeps another team's unit closed", async () => {
    serve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"), active, teamOf("t2", ["u1"]));
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    await openUnit("#05-123");
    expect(screen.getByText(/Only they, their current teammates or an admin/)).toBeInTheDocument();
  });

  it("treats a failed team lookup as no team", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path.endsWith("/teams")) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"));
    });
    render(<BlockScreen blockId="b1" />);
    await openUnit("#05-123");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("does not look for a team before it knows who is signed in, then looks once", async () => {
    const loading = {
      userId: undefined,
      role: undefined,
      isAdmin: false,
      isMember: false,
      isLoading: true,
      isSignedIn: false,
    };
    useRole.mockReturnValue(loading);
    serve(
      list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"),
      active,
      teamOf("t1", ["ann", "u1"]),
    );
    const { rerender } = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/active");
    });
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(apiFetch).not.toHaveBeenCalledWith("/sessions/s1/teams");

    useRole.mockReturnValue({ ...loading, userId: "u1", isLoading: false, isSignedIn: true });
    rerender(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    const calls = apiFetch.mock.calls.map(([path]) => path as string);
    expect(calls.filter((path) => path === "/sessions/s1/teams")).toHaveLength(1);
    // Learning who is signed in does not fetch the units a second time.
    expect(calls.filter((path) => path.startsWith("/households"))).toHaveLength(1);
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  /* A promise settles once, so the late answer and the late failure each
     need their own first request. */
  it.each([
    [
      "answer",
      (late: Late) => {
        late.resolve({ data: [] });
      },
    ],
    [
      "failure",
      (late: Late) => {
        late.reject(new Error("late"));
      },
    ],
  ])("does not let a late %s for an earlier viewer take Amend away", async (_, settle) => {
    const signedIn = (userId: string) => ({
      userId,
      role: "member",
      isAdmin: false,
      isMember: true,
      isLoading: false,
      isSignedIn: true,
    });
    const late: Late = { resolve: () => undefined, reject: () => undefined };
    let first = true;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/sessions/s1/teams") {
        if (first) {
          first = false;
          return new Promise((resolve, reject) => {
            late.resolve = resolve;
            late.reject = reject;
          });
        }
        return Promise.resolve(teamOf("t1", ["ann", "u1"]));
      }
      return Promise.resolve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"));
    });
    useRole.mockReturnValue(signedIn("someone-else"));
    const { rerender } = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    useRole.mockReturnValue(signedIn("u1"));
    rerender(<BlockScreen blockId="b1" />);
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();

    await act(async () => {
      settle(late);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  describe("with the offline queue", () => {
    const record = (unitNumber: string) =>
      buildQueuedVisit(
        {
          blockId: "b1",
          unitNumber,
          interestLevel: "high",
          description: "",
          name: "",
          contact: "",
          religion: "",
          sessionId: "s1",
        },
        "u1",
        Date.parse("2026-10-15T10:00:00.000Z"),
      );

    it("lists a unit saved on this phone before the server has it", async () => {
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, records: [record("#05-124")] });
      serve(list(["#05-123"]));
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);

      await user.click(await screen.findByRole("tab", { name: "All units (2)" }));
      expect(screen.getByText("#05-124").closest("li")).toHaveTextContent("Not sent");
    });

    /* Both refuse the save; only one is fixed by finding signal. */
    it.each([
      [
        "the server says no outing is running",
        () => Promise.reject(new ApiRequestError(404, undefined)),
        "No session is running, so this visit is not saved yet.",
      ],
      [
        "the outing cannot be loaded",
        () => Promise.reject(new TypeError("Failed to fetch")),
        "Could not load the session, so this visit is not saved yet. Check your signal",
      ],
      [
        "the server fails",
        () => Promise.reject(new ApiRequestError(500, undefined)),
        "Could not load the session, so this visit is not saved yet. Check your signal",
      ],
    ])("refuses to queue a save when %s", async (_, outing, message) => {
      const enqueue = vi.fn();
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, enqueue });
      apiFetch.mockImplementation((path: string) =>
        path.startsWith("/sessions/active") ? outing() : Promise.resolve(list([])),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (0)" });

      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "Low" }));
      await user.click(screen.getByRole("button", { name: "Save and next" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("re-reads the units once a queued record reaches the server, and not before", async () => {
      const queue = { ...NO_QUEUE, records: [record("#05-124")] };
      useSyncQueue.mockImplementation(() => queue);
      serve(list(["#05-123"]));
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (2)" });
      const households = () =>
        apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/households")).length;
      expect(households()).toBe(1);

      view.rerender(<BlockScreen blockId="b1" />);
      expect(households()).toBe(1);

      serve(list(["#05-123", "#05-124"]));
      queue.records = [{ ...record("#05-124"), state: "synced" }];
      queue.syncedVersion = 1;
      view.rerender(<BlockScreen blockId="b1" />);

      await waitFor(() => {
        expect(households()).toBe(2);
      });
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });
});

describe("the offline copy", () => {
  it("is given the block's units with the outing they were loaded under", async () => {
    const units = list(["#05-123"]);
    serve(units);
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(noteBlock).toHaveBeenCalledWith(active, "b1", units.data);
    });
  });

  it("waits for the outing when the units arrive first", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const units = list(["#05-123"]);
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(path.endsWith("/teams") ? { data: [] } : units),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(noteBlock).not.toHaveBeenCalled();

    await act(async () => {
      answer(active);
      await Promise.resolve();
    });
    expect(noteBlock).toHaveBeenCalledWith(active, "b1", units.data);
  });

  it("is not written when the outing cannot be learnt", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new ApiRequestError(500, undefined))
        : Promise.resolve(list(["#05-123"])),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(noteBlock).not.toHaveBeenCalled();
  });

  it("is not written when the units cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.resolve(active)
        : path.endsWith("/teams")
          ? Promise.resolve({ data: [] })
          : Promise.reject(new Error("offline")),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("alert");
    expect(noteBlock).not.toHaveBeenCalled();
  });
});
