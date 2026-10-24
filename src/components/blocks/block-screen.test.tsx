import { act, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { BlockScreen } from "@/components/blocks/block-screen";
import { ApiRequestError } from "@/lib/api-client";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { noteOuting, noteBlock, noteRevisits } = vi.hoisted(() => ({
  noteOuting: vi.fn(),
  noteBlock: vi.fn(),
  noteRevisits: vi.fn(),
}));
vi.mock("@/components/sync/local-copy-writer", () => ({
  useLocalCopyWriter: () => ({ noteOuting, noteBlock, noteRevisits }),
}));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

/* Unavailable unless a test says otherwise, so a save goes straight to the
   server as it does where IndexedDB cannot be opened. */
const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));
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

  it("has Save where it docks in the server's HTML, then hands it to the form", async () => {
    serve(list([]));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<BlockScreen blockId="b1" />);
    const first = within(container).getByRole("button", { name: "Save and next" });
    // At the end of the screen, where it can rise to the nav at any text
    // size; and, with no script yet to save, a tap must not reload the page.
    expect(container.querySelector("form")).not.toContainElement(first);
    expect(first).toHaveAttribute("type", "button");

    render(<BlockScreen blockId="b1" />);
    const save = await screen.findByRole("button", { name: "Save and next" });
    expect(save).toHaveAttribute("type", "submit");
    expect(save).toHaveAttribute("form", document.querySelector("form")?.id);
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

describe("in a follow-up session", () => {
  const followUp = {
    session: { id: "s1", title: "Revisits", kind: "follow_up" },
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
  };
  const revisits = {
    data: [
      {
        household: { ...list(["#05-123"]).data[0]?.household, blockId: "b1" },
        block: followUp.blocks[0]?.block,
        notes: [{ id: "n1", doneAt: null }],
        latestVisit: null,
        visitedInSession: false,
      },
    ],
  };

  function serveFollowUp(listAnswer: () => Promise<unknown> = () => Promise.resolve(revisits)) {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(followUp);
      if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
      if (path === "/sessions/s1/revisits") return listAnswer();
      return Promise.resolve(list(["#05-123"]));
    });
  }

  it("says only listed units can be recorded, and offers them", async () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    expect(
      await screen.findByText(/Only units on the list can be recorded\.$/),
    ).toBeInTheDocument();
    const chips = within(await screen.findByRole("list", { name: "On the list in this block" }));
    expect(chips.getByRole("button", { name: "#05-123" })).toBeInTheDocument();
  });

  it("keeps the list on the phone for the offline shell", async () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(noteRevisits).toHaveBeenCalledWith(followUp, revisits.data);
    });
  });

  it("tells an admin they can record any unit", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByText(/As an admin you can record any unit\./)).toBeInTheDocument();
  });

  it("says it could not check the list when it cannot be read", async () => {
    serveFollowUp(() => Promise.reject(new TypeError("offline")));
    const user = userEvent.setup();
    render(<BlockScreen blockId="b1" />);
    await screen.findByText(/Only units on the list can be recorded/);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /^Could not check the follow-up list\./,
    );
    expect(noteRevisits).not.toHaveBeenCalled();
  });

  it("arrives with the unit picked from the list", () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" initialUnit="#05-123" />);
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
  });

  it("asks for no list in a door-to-door session", async () => {
    serve(list([]), { ...followUp, session: { ...followUp.session, kind: "regular" } });
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("heading", { level: 1, name: "Blk 123" });
    expect(apiFetch).not.toHaveBeenCalledWith("/sessions/s1/revisits");
    expect(screen.queryByText(/Only units on the list/)).toBeNull();
  });

  it("lets only the newest list land when the session answers twice", async () => {
    let late: (value: unknown) => void = () => undefined;
    let calls = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(followUp);
      if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
      if (path === "/sessions/s1/revisits") {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              late = resolve;
            })
          : Promise.resolve({ data: [] });
      }
      return Promise.resolve(list(["#05-123"]));
    });
    const queue = { ...NO_QUEUE };
    useSyncQueue.mockReturnValue(queue);
    const view = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    // A record reaching the server re-reads the list.
    useSyncQueue.mockReturnValue({ ...queue, syncedVersion: 1 });
    view.rerender(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    await act(async () => {
      late(revisits);
      await Promise.resolve();
    });
    expect(screen.queryByRole("list", { name: "On the list in this block" })).toBeNull();
  });

  describe("when the list may have moved under the screen", () => {
    const entry = (unitNumber: string) => ({
      ...revisits.data[0],
      household: { ...revisits.data[0]?.household, id: `h-${unitNumber}`, unitNumber },
    });
    const listOf = (...units: string[]) => ({ data: units.map(entry) });
    const chipNames = () =>
      within(screen.getByRole("list", { name: "On the list in this block" }))
        .getAllByRole("button")
        .map((chip) => chip.textContent);
    const reads = () => apiFetch.mock.calls.filter(([path]) => path === "/sessions/s1/revisits");

    /* Answers each read of the list with the next of `answers`, the last for good. */
    function serveLists(...answers: (() => Promise<unknown>)[]) {
      let read = 0;
      serveFollowUp(() => {
        const answer = answers[Math.min(read, answers.length - 1)];
        read += 1;
        return answer === undefined ? Promise.resolve(revisits) : answer();
      });
    }

    const held = (unitNumber: string, code: string): QueuedVisit => ({
      ...buildQueuedVisit(
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
      ),
      state: "held",
      lastError: { code },
    });

    it("stops offering a unit once the server holds a record there as off the list", async () => {
      // An admin took #05-124 off the list after this screen read it.
      serveLists(
        () => Promise.resolve(listOf("#05-123", "#05-124")),
        () => Promise.resolve(listOf("#05-123")),
      );
      const queue = { ...NO_QUEUE };
      useSyncQueue.mockReturnValue(queue);
      const user = userEvent.setup();
      const view = render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      });

      // Held for another reason, the list is not the question.
      useSyncQueue.mockReturnValue({ ...queue, records: [held("#05-124", "session_not_active")] });
      view.rerender(<BlockScreen blockId="b1" />);
      expect(reads()).toHaveLength(1);

      useSyncQueue.mockReturnValue({
        ...queue,
        records: [held("#05-124", "not_on_follow_up_list")],
      });
      view.rerender(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.getByText(/is not on the follow-up list/)).toBeVisible();
    });

    it("reads the list again when the member comes back to the app", async () => {
      // Asked to add a unit, the admin may have while the phone was away.
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.resolve(listOf("#05-123", "#05-124")),
      );
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });

      // Put away, nothing is read: nobody is looking.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      Reflect.deleteProperty(document, "visibilityState");
      expect(document.visibilityState).toBe("visible");
      expect(reads()).toHaveLength(1);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      });
    });

    it("keeps the list it has when a later read fails", async () => {
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.reject(new TypeError("offline")),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => {
        expect(reads()).toHaveLength(2);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.getByText(/is not on the follow-up list/)).toBeVisible();
      expect(screen.queryByText(/Could not check the follow-up list/)).toBeNull();
      expect(chipNames()).toEqual(["#05-123"]);
    });

    it("says nothing about the list while it is first read", async () => {
      // The usual way in: a household tapped on the list, on weak signal.
      serveLists(() => new Promise(() => undefined));
      render(<BlockScreen blockId="b1" initialUnit="#05-124" />);
      await screen.findByText(/Only units on the list can be recorded/);
      await waitFor(() => {
        expect(reads()).toHaveLength(1);
      });
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
      expect(screen.queryByText(/Could not check the follow-up list/)).toBeNull();
      expect(screen.queryByText(/is not on the follow-up list/)).toBeNull();
    });

    it("saves a unit an admin added since the list was read, and shows it on the list", async () => {
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.resolve(listOf("#05-123", "#05-124")),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          "/visits",
          expect.objectContaining({ method: "POST" }),
        );
      });
      expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      expect(screen.queryByText(/Not saved/)).toBeNull();
    });
  });
});
